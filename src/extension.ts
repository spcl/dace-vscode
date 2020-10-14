import * as vscode from 'vscode';
import * as fs from 'fs';

import { SdfgViewerProvider } from './components/sdfgViewer';
import { DaCeInterface } from './daceInterface';
import { TransformationsProvider } from './transformation/transformations';
import { TransformationHistoryProvider } from './transformation/transformationHistory';
import { OutlineProvider } from './components/outline';
import { SymbolResolutionProvider } from './components/symbolResolution';

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

        // Create and register the transformations view.
        const transformationsProvider = TransformationsProvider.getInstance();
        context.subscriptions.push(vscode.window.registerTreeDataProvider(
            'transformationView',
            transformationsProvider
        ));

        // Create and register the view for the transformation history.
        const trafoHistoryProvider =
            TransformationHistoryProvider.getInstance();
        context.subscriptions.push(vscode.window.registerTreeDataProvider(
            'transformationHistory',
            trafoHistoryProvider
        ));

        // Register the SDFG custom editor.
        context.subscriptions.push(SdfgViewerProvider.register(context));

        // Register all webview view components.
        context.subscriptions.push(OutlineProvider.register(context));
        context.subscriptions.push(SymbolResolutionProvider.register(context));

        // Register necessary commands.
        this.registerCommand('transformationView.refreshEntry', () => {
            transformationsProvider.refresh();
        });
        this.registerCommand('symbolResolution.refreshEntry', () => {
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                type: 'refresh_symbol_list',
            });
        });
        this.registerCommand('sdfgOutline.refreshEntry', () => {
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

    public updateActiveSdfg(activeSdfgFileName: string,
                            activeEditor: vscode.Webview | undefined) {
        this.activeSdfgFileName = activeSdfgFileName;
        this.activeEditor = activeEditor;
        TransformationsProvider.getInstance().refresh();
        TransformationHistoryProvider.getInstance().refresh();
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