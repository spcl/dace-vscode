// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import { homedir } from 'os';
import { join } from 'path';

import { SdfgViewer, SdfgViewerProvider } from './components/sdfg_viewer';
import { DaCeInterface } from './dace_interface';
import {
    TransformationHistoryProvider,
} from './components/transformation_history';
import { OutlineProvider } from './components/outline';
import { AnalysisProvider } from './components/analysis';
import { TransformationListProvider } from './components/transformation_list';
import { SdfgBreakpointProvider } from './components/sdfg_breakpoints';
import { activateSdfgPython } from './debugger/sdfg_python_debugger';
import { activateDaceDebug } from './debugger/dace_debugger';
import { executeTrusted } from './utils/utils';

export class DaCeVSCode {

    private static INSTANCE = new DaCeVSCode();

    private constructor() { }

    public static getInstance(): DaCeVSCode {
        return this.INSTANCE;
    }

    private context?: vscode.ExtensionContext;

    private outputChannel?: vscode.OutputChannel;

    private activeEditor?: SdfgViewer;
    private activeWebview?: vscode.Webview;
    private activeSdfgFileName?: string;

    private trafoProvider?: TransformationListProvider;
    private trafoHistProvider?: TransformationHistoryProvider;
    private outlineProvider?: OutlineProvider;
    private analysisProvider?: AnalysisProvider;

    public registerCommand(command: string, handler: (...args: any[]) => any) {
        this.context?.subscriptions.push(vscode.commands.registerCommand(
            command, handler
        ));
    }

    private openInstrumentationReport(url: vscode.Uri, report: any) {
        // Show the SDFG Analysis panel if it's hidden.
        if (!this.analysisProvider)
            return;

        // Make the analysis panel visible.
        if (!this.analysisProvider.isVisible())
            vscode.commands.executeCommand(
                'sdfgAnalysis.focus'
            );

        this.analysisProvider.invokeRemote(
            'onAutoloadReport', [url.fsPath]
        ).then((criterium: string) => {
            this.analysisProvider?.onLoadInstrumentationReport(
                report, criterium
            );
        });
    }

    private openGeneratedSdfg(
        sdfgUri: vscode.Uri,
        sourcePath: string,
        linkFile?: string,
        argv?: string[]
    ) {
        vscode.commands.executeCommand(
            'vscode.openWith',
            sdfgUri,
            'sdfgCustom.sdfv'
        ).then(() => {
            const editor =
                SdfgViewerProvider.getInstance()
                    ?.findEditorForPath(sdfgUri);
            if (editor) {
                editor.wrapperFile = sourcePath;
                editor.linkFile = linkFile;
                editor.argv = argv;
            }
        });
    }

    private async parseSdfgLinkFile(
        raw: string, path: string
    ): Promise<boolean> {
        const lines = raw.split(/\r?\n/);
        if (lines.length < 2)
            return false;

        // Check that the header defines the correct columns exepcted in this
        // file.
        const header = lines[0];
        const cols = header.split(',');
        if (cols.length < 4)
            return false;

        if (cols[0] !== 'name' || cols[1] !== 'SDFG_intermediate' ||
            cols[2] !== 'SDFG' || cols[3] !== 'source')
            return false;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];

            const elements = line.split(',');

            if (elements.length !== cols.length)
                return false;

            if (elements.length >= 4) {
                const name = elements[0];
                const intermediateSdfgPath = elements[1];
                const intermediateSdfgUri =
                    vscode.Uri.file(intermediateSdfgPath);
                const sdfgPath = elements[2];
                const sdfgUri = vscode.Uri.file(sdfgPath);
                const sourcePath = elements[3];
                const argv = elements.slice(4, elements.length - 1);

                // Check if the SDFG file actually exists. If not, check if the
                // _dacegraphs SDFG exists as a fallback.
                let targetUri = intermediateSdfgUri;
                try {
                    await vscode.workspace.fs.stat(targetUri);
                } catch {
                    targetUri = sdfgUri;
                    try {
                        await vscode.workspace.fs.stat(targetUri);
                    } catch {
                        // The _dacegraphs SDFG also doesn't exist, move on.
                        continue;
                    }
                }

                // Check if the SDFG isn't currently open. If it is, don't
                // do anything.
                if (this.activeSdfgFileName !== undefined &&
                    targetUri.fsPath ===
                    vscode.Uri.file(this.activeSdfgFileName).fsPath)
                    continue;

                const autoOpen =
                    vscode.workspace.getConfiguration('dace.general');
                const configKey = 'autoOpenSdfgs';

                const autoOpenPref = autoOpen?.get<string>(configKey);
                if (autoOpenPref === 'Always') {
                    this.openGeneratedSdfg(
                        targetUri,
                        sourcePath,
                        path,
                        argv
                    );
                    continue;
                } else if (autoOpenPref === 'Never') {
                    continue;
                } else {
                    vscode.window.showInformationMessage(
                        'An SDFG with the name ' + name +
                        ' was generated, do you want to show it?',
                        'Always',
                        'Yes',
                        'No',
                        'Never'
                    ).then((opt) => {
                        switch (opt) {
                            case 'Always':
                                autoOpen.update(configKey, 'Always');
                            // Fall through.
                            case 'Yes':
                                this.openGeneratedSdfg(
                                    targetUri,
                                    sourcePath,
                                    path,
                                    argv
                                );
                                break;
                            case 'Never':
                                autoOpen.update(configKey, 'Never');
                            // Fall through.
                            case 'No':
                                break;
                        }
                    });
                }
            }
        }
        return true;
    }

    public init(context: vscode.ExtensionContext) {
        this.context = context;

        // Register the SDFG custom editor.
        context.subscriptions.push(SdfgViewerProvider.register(context));

        // Register all webview view components.
        context.subscriptions.push(
            TransformationListProvider.register(context)
        );
        this.trafoProvider = TransformationListProvider.getInstance();
        context.subscriptions.push(
            TransformationHistoryProvider.register(context)
        );
        this.trafoHistProvider = TransformationHistoryProvider.getInstance();
        context.subscriptions.push(
            OutlineProvider.register(context)
        );
        this.outlineProvider = OutlineProvider.getInstance();
        context.subscriptions.push(
            AnalysisProvider.register(context)
        );
        this.analysisProvider = AnalysisProvider.getInstance();
        context.subscriptions.push(
            SdfgBreakpointProvider.register(context)
        );

        // Register necessary commands.
        this.registerCommand('sdfg.compile', () => {
            const sdfgFile = DaCeVSCode.getInstance().getActiveSdfgFileName();
            if (sdfgFile) {
                const uri = vscode.Uri.file(sdfgFile);

                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Window,
                    title: 'Compiling SDFG',
                    cancellable: false,
                }, (_progress) => {
                    return new Promise<string>((resolve, reject) => {
                        DaCeInterface.getInstance().compileSdfgFromFile(
                            uri, (data: any) => {
                                if (data.filename === undefined) {
                                    let errorMsg = 'Failed to compile SDFG.';
                                    if (data.error)
                                        errorMsg += ' Error message: ' +
                                            data.error.message + ' (' +
                                            data.error.details + ')';
                                    vscode.window.showErrorMessage(errorMsg);
                                    console.error(errorMsg);
                                    reject();
                                } else {
                                    resolve(data.filename);
                                }
                            },
                            false
                        );
                    });
                }).then((filename) => {
                    vscode.window.showInformationMessage(
                        'SDFG compiled, library generated at: ' + filename
                    );
                });
            }
        });
        this.registerCommand('transformationList.addCustom', () => {
            executeTrusted(() => {
                DaCeInterface.getInstance().addCustomTransformations(false);
            }, false , 'Loading custom transformations');
        });
        this.registerCommand('transformationList.addCustomFromDir', () => {
            executeTrusted(() => {
                DaCeInterface.getInstance().addCustomTransformations(true);
            }, false , 'Loading custom transformations');
        });
        this.registerCommand('transformationList.sync', () => {
            DaCeVSCode.getInstance().getActiveEditor()?.messageHandler?.invoke(
                'refreshTransformationList'
            );
        });
        this.registerCommand('transformationHistory.sync', () => {
            if (DaCeVSCode.getInstance().getActiveWebview() !== undefined)
                TransformationHistoryProvider.getInstance()?.refresh();
        });
        this.registerCommand('sdfgAnalysis.sync', () => {
            DaCeVSCode.getInstance().getActiveEditor()?.messageHandler?.invoke(
                'refreshAnalysisPane'
            );
        });
        this.registerCommand('sdfgBreakpoints.sync', () => {
            SdfgBreakpointProvider.getInstance()?.refresh();
        });
        this.registerCommand('sdfgOutline.sync', () => {
            DaCeVSCode.getInstance().getActiveEditor()?.messageHandler?.invoke(
                'outline'
            );
        });
        this.registerCommand('sdfg.sync', () => {
            const activeEditor = DaCeVSCode.getInstance().getActiveEditor();
            if (activeEditor)
                SdfgViewerProvider.getInstance()?.updateEditor(activeEditor);
        });
        this.registerCommand('sdfg.applyTransformations',
            (t) => DaCeInterface.getInstance().applyTransformations(t));
        this.registerCommand('sdfg.previewTransformation',
            (t) => DaCeInterface.getInstance().previewTransformation(t));
        this.registerCommand('sdfg.previewHistoryPoint',
            (h) => DaCeInterface.getInstance().previewHistoryPoint(h));
        this.registerCommand('sdfg.applyHistoryPoint',
            (h) => DaCeInterface.getInstance().applyHistoryPoint(h));
        this.registerCommand('dace.installDace', () => {
            executeTrusted(() => {
                const term = vscode.window.createTerminal('Install DaCe');
                term.show();
                term.sendText(
                    'pip install dace'
                );
            }, false, 'Installing DaCe');
        });
        this.registerCommand('dace.config', () => {
            executeTrusted(() => {
                const uri = vscode.Uri.file(
                    join(homedir(), '.dace.conf')
                );
                vscode.commands.executeCommand(
                    'vscode.openWith', uri, 'default'
                );
            }, false, 'Accessing the user\'s dace.config');
        });

        const sdfgWatcher = vscode.workspace.createFileSystemWatcher(
            '**/.dacecache/**/program.sdfgl'
        );
        sdfgWatcher.onDidCreate((url) => {
            vscode.workspace.fs.readFile(url).then((data) => {
                this.parseSdfgLinkFile(data.toString(), url.fsPath);
            });
        });
        sdfgWatcher.onDidChange((url) => {
            vscode.workspace.fs.readFile(url).then((data) => {
                this.parseSdfgLinkFile(data.toString(), url.fsPath);
            });
        });

        const perfReportWatcher = vscode.workspace.createFileSystemWatcher(
            '**/.dacecache/**/perf/*.json'
        );
        perfReportWatcher.onDidCreate((url) => {
            vscode.workspace.fs.readFile(url).then((data) => {
                const report = JSON.parse(data.toString());

                const autoOpen =
                    vscode.workspace.getConfiguration('dace.general');
                const configKey = 'autoOpenInstrumentationReports';

                const autoOpenPref = autoOpen?.get<string>(configKey);
                if (autoOpenPref === 'Always') {
                    this.openInstrumentationReport(url, report);
                    return;
                } else if (autoOpenPref === 'Never') {
                    return;
                } else {
                    vscode.window.showInformationMessage(
                        'A report file was just generated, do you want to ' +
                            'load it?',
                        'Always',
                        'Yes',
                        'No',
                        'Never'
                    ).then((opt) => {
                        switch (opt) {
                            case 'Always':
                                autoOpen.update(configKey, 'Always');
                            // Fall through.
                            case 'Yes':
                                this.openInstrumentationReport(url, report);
                                break;
                            case 'Never':
                                autoOpen.update(configKey, 'Never');
                            // Fall through.
                            case 'No':
                                break;
                        }
                    });
                }
            });
        });

        activateSdfgPython(context);
        activateDaceDebug(context);
    }

    public getExtensionContext() {
        return this.context;
    }

    public static getExtensionContext() {
        return this.INSTANCE.getExtensionContext();
    }

    public getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel)
            this.outputChannel = vscode.window.createOutputChannel(
                'SDFG Viewer'
            );
        return this.outputChannel;
    }

    public getActiveWebview(): vscode.Webview | undefined {
        return this.activeWebview;
    }

    public getActiveEditor(): SdfgViewer | undefined {
        return this.activeEditor;
    }

    public getActiveSdfgFileName(): string | undefined {
        return this.activeSdfgFileName;
    }

    public clearActiveSdfg() {
        this.activeSdfgFileName = undefined;
        this.activeWebview = undefined;
        this.activeEditor = undefined;

        const clearReason = 'No SDFG selected';
        this.outlineProvider?.clearOutline(clearReason);
        this.analysisProvider?.clear(clearReason);
        this.trafoHistProvider?.clearList(clearReason);
        this.trafoProvider?.clearTransformations(clearReason);
    }

    public updateActiveSdfg(
        activeEditorEditor: SdfgViewer, activeSdfgFileName: string,
        activeEditor: vscode.Webview
    ) {
        this.activeSdfgFileName = activeSdfgFileName;
        this.activeWebview = activeEditor;
        this.activeEditor = activeEditorEditor;

        this.trafoProvider?.refresh();
        this.trafoHistProvider?.refresh();
        this.outlineProvider?.refresh();
        this.analysisProvider?.refresh();
    }

    public async getActiveSdfg(fromDisk = false): Promise<any | undefined> {
        let sdfgJson = undefined;
        if (fromDisk === true) {
            if (this.activeSdfgFileName)
                sdfgJson = (await vscode.workspace.fs.readFile(
                    vscode.Uri.file(this.activeSdfgFileName)
                )).toString();
        } else {
            if (this.activeWebview) {
                const document = SdfgViewerProvider.getInstance()
                    ?.findEditorForWebview(this.activeWebview)?.document;
                if (document)
                    sdfgJson = document.getText();
            }
        }
        if (sdfgJson === '' || !sdfgJson)
            sdfgJson = undefined;
        else
            sdfgJson = JSON.parse(sdfgJson);
        return sdfgJson;
    }

}

/**
 * Activates the plugin.
 * @param context The extension context to load into.
 */
export function activate(context: vscode.ExtensionContext) {
    DaCeVSCode.getInstance().init(context);
}

/**
 * Called when the extension gets deactivated, ie. when VSCode is shut down.
 */
export function deactivate() {
    let context = DaCeVSCode.getInstance().getExtensionContext();
    if (context)
        context.subscriptions.forEach(item => item.dispose());
}
