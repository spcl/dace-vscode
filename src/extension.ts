import * as vscode from 'vscode';
import * as fs from 'fs';

import { SdfgViewerProvider } from './components/sdfgViewer';
import { DaCeInterface } from './daceInterface';
import { TransformationHistoryProvider } from './components/transformationHistory';
import { OutlineProvider } from './components/outline';
import { AnalysisProvider } from './components/analysis';
import { TransformationListProvider } from './components/transformationList';
import { activateSdfgPython } from './debugger/sdfgPythonDebugger';

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

                if (fs.existsSync(sdfgPath)) {
                    // Check if the SDFG isn't currently open. If it is, don't
                    // do anything.
                    if (this.activeSdfgFileName !== undefined &&
                        vscode.Uri.file(sdfgPath).fsPath ===
                        vscode.Uri.file(this.activeSdfgFileName).fsPath)
                        continue;

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
                                // TODO: Save this preference!
                                // Fall through.
                            case 'Yes':
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
                                        editor.linkFile = path;
                                        editor.argv = argv;
                                    }
                                });
                                break;
                            case 'Never':
                                // TODO: Save this preference!
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

        // Connect to DaCe.
        const daceInterface = DaCeInterface.getInstance();
        daceInterface.start();

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
            (t) => daceInterface.applyTransformation(t));
        this.registerCommand('sdfg.previewTransformation',
            (t) => daceInterface.previewTransformation(t));
        this.registerCommand('sdfg.previewHistoryPoint',
            (h) => daceInterface.previewHistoryPoint(h));
        this.registerCommand('sdfg.applyHistoryPoint',
            (h) => daceInterface.applyHistoryPoint(h));
        this.registerCommand('dace.openOptimizerInTerminal',
            () => daceInterface.startDaemonInTerminal());
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
        sdfgWatcher.onDidCreate((e) => {
            let stringData = '';
            fs.createReadStream(
                e.fsPath
            ).on('data', (data) => {
                stringData += data.toString('utf-8');
            }).on('end', () => {
                this.parseSdfgLinkFile(stringData, e.fsPath);
            });
        });
        sdfgWatcher.onDidChange((e) => {
            let stringData = '';
            fs.createReadStream(
                e.fsPath
            ).on('data', (data) => {
                stringData += data.toString('utf-8');
            }).on('end', () => {
                this.parseSdfgLinkFile(stringData, e.fsPath);
            });
        });

        const perfReportWatcher = vscode.workspace.createFileSystemWatcher(
            '**/.dacecache/**/perf/*.json'
        );
        perfReportWatcher.onDidCreate((e) => {
            let path = e.fsPath;
            let stringData = '';

            const readStream = fs.createReadStream(path);

            readStream.on('data', (data) => {
                stringData += data.toString('utf-8');
            });

            readStream.on('end', () => {
                let report = JSON.parse(stringData);

                vscode.window.showInformationMessage(
                    'A report file was just generated, do you want to load it?',
                    'Always',
                    'Yes',
                    'No',
                    'Never'
                ).then((opt) => {
                    switch (opt) {
                        case 'Always':
                            // TODO: Save this preference!
                            // Fall through.
                        case 'Yes':
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
                                path: path,
                                json: report,
                            }, undefined);
                            break;
                        case 'Never':
                            // TODO: Save this preference!
                            // Fall through.
                        case 'No':
                            break;
                    }
                });
            });
        });

        activateSdfgPython(context);
    }

    public getExtensionContext() {
        return this.context;
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

    public getActiveSdfg(): any | undefined {
        let sdfgJson = undefined;
        if (this.activeSdfgFileName)
            sdfgJson = fs.readFileSync(this.activeSdfgFileName, 'utf8');
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