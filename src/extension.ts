import * as vscode from 'vscode';
import * as fs from 'fs';

import { SdfgViewerProvider } from './components/sdfgViewer';
import { DaCeInterface } from './daceInterface';
import { TransformationHistoryProvider } from './components/transformationHistory';
import { OutlineProvider } from './components/outline';
import { AnalysisProvider } from './components/analysis';
import { TransformationListProvider } from './components/transformationList';

export class DaCeVSCode {

    private static INSTANCE = new DaCeVSCode();

    private constructor() { }

    public static getInstance(): DaCeVSCode {
        return this.INSTANCE;
    }

    private context: vscode.ExtensionContext | undefined = undefined;

    private outputChannel: vscode.OutputChannel | undefined;

    private activeEditor: vscode.Webview | undefined = undefined;
    private activeSdfgFileName: string | undefined = undefined;

    private trafoProvider: TransformationListProvider | undefined = undefined;
    private trafoHistProvider: TransformationHistoryProvider | undefined = undefined;
    private outlineProvider: OutlineProvider | undefined = undefined;
    private analysisProvider: AnalysisProvider | undefined = undefined;

    private registerCommand(command: string, handler: (...args: any[]) => any) {
        this.context?.subscriptions.push(vscode.commands.registerCommand(
            command, handler
        ));
    }

    public init(context: vscode.ExtensionContext) {
        this.context = context;

        // Connect to DaCe.
        const daceInterface = DaCeInterface.getInstance();
        daceInterface.start();

        // Register the SDFG custom editor.
        context.subscriptions.push(SdfgViewerProvider.register(context));

        // Register all webview view components.
        context.subscriptions.push(TransformationListProvider.register(context));
        this.trafoProvider = TransformationListProvider.getInstance();
        context.subscriptions.push(TransformationHistoryProvider.register(context));
        this.trafoHistProvider = TransformationHistoryProvider.getInstance();
        context.subscriptions.push(OutlineProvider.register(context));
        this.outlineProvider = OutlineProvider.getInstance();
        context.subscriptions.push(AnalysisProvider.register(context));
        this.analysisProvider = AnalysisProvider.getInstance();

        // Register necessary commands.
        this.registerCommand('transformationList.sync', () => {
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                type: 'get_applicable_transformations',
            });
        });
        this.registerCommand('transformationHistory.sync', () => {
            TransformationHistoryProvider.getInstance()?.refresh();
        });
        this.registerCommand('sdfgAnalysis.sync', () => {
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                type: 'refresh_symbol_list',
            });
        });
        this.registerCommand('sdfgOutline.sync', () => {
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

        this.outlineProvider?.clearOutline();
        this.analysisProvider?.clearSymbols();
        this.trafoHistProvider?.clearList();
        this.trafoProvider?.clearList();
    }

    public updateActiveSdfg(activeSdfgFileName: string,
                            activeEditor: vscode.Webview) {
        this.clearActiveSdfg();

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