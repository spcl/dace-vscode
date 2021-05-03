// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';

import { SdfgViewerProvider } from './components/sdfgViewer';
import { DaCeInterface } from './daceInterface';
import { TransformationHistoryProvider } from './components/transformationHistory';
import { OutlineProvider } from './components/outline';
import { AnalysisProvider } from './components/analysis';
import { TransformationListProvider } from './components/transformationList';
import { activateSdfgPython } from './debugger/sdfgPythonDebugger';
import { activateDaceDebug } from './debugger/daceDebugger';

export class DaCeVSCode {

    private static INSTANCE = new DaCeVSCode();

    private constructor() { }

    public static getInstance(): DaCeVSCode {
        return this.INSTANCE;
    }

    private context?: vscode.ExtensionContext = undefined;

    private outputChannel?: vscode.OutputChannel = undefined;

    private activeEditor?: vscode.Webview = undefined;
    private activeSdfgFileName?: string = undefined;

    private trafoProvider?: TransformationListProvider = undefined;
    private trafoHistProvider?: TransformationHistoryProvider = undefined;
    private outlineProvider?: OutlineProvider = undefined;
    private analysisProvider?: AnalysisProvider = undefined;

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

        this.analysisProvider.handleMessage({
            type: 'autoload_report',
            path: url.fsPath,
            json: report,
        }, undefined);
    }

    private openGeneratedSdfg(
        sdfgPath: string,
        sourcePath: string,
        linkFile?: string,
        argv?: string[]
    ) {
        const sdfgUri = vscode.Uri.file(sdfgPath);
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

    private parseSdfgLinkFile(raw: string, path: string): boolean {
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
                const sdfgPath = elements[2];
                const sourcePath = elements[3];
                const argv = elements.slice(4, elements.length - 1);

                // Check if the SDFG isn't currently open. If it is, don't
                // do anything.
                if (this.activeSdfgFileName !== undefined &&
                    vscode.Uri.file(sdfgPath).fsPath ===
                    vscode.Uri.file(this.activeSdfgFileName).fsPath)
                    continue;

                let autoOpen = this.context?.workspaceState.get(
                    'SDFV_auto_open_generated_sdfg'
                );

                if (autoOpen !== undefined) {
                    if (autoOpen)
                        this.openGeneratedSdfg(
                            sdfgPath,
                            sourcePath,
                            path,
                            argv
                        );
                    continue;
                }

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
                            this.context?.workspaceState.update(
                                'SDFV_auto_open_generated_sdfg',
                                true
                            );
                            // Fall through.
                        case 'Yes':
                            this.openGeneratedSdfg(
                                sdfgPath,
                                sourcePath,
                                path,
                                argv
                            );
                            break;
                        case 'Never':
                            this.context?.workspaceState.update(
                                'SDFV_auto_open_generated_sdfg',
                                false
                            );
                            // Fall through.
                        case 'No':
                            break;
                    }
                });
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

        // Register necessary commands.
        this.registerCommand('transformationList.sync', () => {
            if (DaCeVSCode.getInstance().getActiveEditor() !== undefined)
                DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                    type: 'get_applicable_transformations',
                });
        });
        this.registerCommand('transformationHistory.sync', () => {
            if (DaCeVSCode.getInstance().getActiveEditor() !== undefined)
                TransformationHistoryProvider.getInstance()?.refresh();
        });
        this.registerCommand('sdfgAnalysis.sync', () => {
            if (DaCeVSCode.getInstance().getActiveEditor() !== undefined)
                DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                    type: 'refresh_analysis_pane',
                });
        });
        this.registerCommand('sdfgOutline.sync', () => {
            if (DaCeVSCode.getInstance().getActiveEditor() !== undefined)
                DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                    type: 'refresh_outline',
                });
        });
        this.registerCommand('sdfg.applyTransformation',
            (t) => DaCeInterface.getInstance().applyTransformation(t));
        this.registerCommand('sdfg.previewTransformation',
            (t) => DaCeInterface.getInstance().previewTransformation(t));
        this.registerCommand('sdfg.previewHistoryPoint',
            (h) => DaCeInterface.getInstance().previewHistoryPoint(h));
        this.registerCommand('sdfg.applyHistoryPoint',
            (h) => DaCeInterface.getInstance().applyHistoryPoint(h));
        this.registerCommand('dace.openOptimizerInTerminal',
            () => DaCeInterface.getInstance().startDaemonInTerminal());
        this.registerCommand('dace.installDace', () => {
            const term = vscode.window.createTerminal('Install DaCe');
            term.show();
            term.sendText(
                'pip install dace'
            );
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
                let report = JSON.parse(data.toString());

                let autoOpen = this.context?.workspaceState.get(
                    'SDFV_auto_open_instrumentation_report'
                );

                if (autoOpen !== undefined) {
                    if (autoOpen)
                        this.openInstrumentationReport(url, report);
                    return;
                }

                vscode.window.showInformationMessage(
                    'A report file was just generated, do you want to load it?',
                    'Always',
                    'Yes',
                    'No',
                    'Never'
                ).then((opt) => {
                    switch (opt) {
                        case 'Always':
                            this.context?.workspaceState.update(
                                'SDFV_auto_open_instrumentation_report',
                                true
                            );
                            // Fall through.
                        case 'Yes':
                            this.openInstrumentationReport(url, report);
                            break;
                        case 'Never':
                            this.context?.workspaceState.update(
                                'SDFV_auto_open_instrumentation_report',
                                false
                            );
                            // Fall through.
                        case 'No':
                            break;
                    }
                });
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

    public getActiveEditor(): vscode.Webview | undefined {
        return this.activeEditor;
    }

    public getActiveSdfgFileName(): string | undefined {
        return this.activeSdfgFileName;
    }

    public clearActiveSdfg() {
        this.activeSdfgFileName = undefined;
        this.activeEditor = undefined;

        const clearReason = 'No SDFG selected';
        this.outlineProvider?.clearOutline(clearReason);
        this.analysisProvider?.clear(clearReason);
        this.trafoHistProvider?.clearList(clearReason);
        this.trafoProvider?.clearList(clearReason);
    }

    public updateActiveSdfg(activeSdfgFileName: string,
                            activeEditor: vscode.Webview) {
        this.activeSdfgFileName = activeSdfgFileName;
        this.activeEditor = activeEditor;

        this.trafoProvider?.refresh();
        this.trafoHistProvider?.refresh();
        this.outlineProvider?.refresh();
        this.analysisProvider?.refresh();
    }

    public async getActiveSdfg(fromDisk=false): Promise<any | undefined> {
        let sdfgJson = undefined;
        if (fromDisk === true) {
            if (this.activeSdfgFileName)
                sdfgJson = (await vscode.workspace.fs.readFile(
                    vscode.Uri.file(this.activeSdfgFileName)
                )).toString();
        } else {
            if (this.activeEditor) {
                const document = SdfgViewerProvider.getInstance()
                    ?.findEditorForWebview(this.activeEditor)?.document;
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
}