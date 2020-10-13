import * as vscode from 'vscode';
import * as fs from 'fs';

import { SdfgViewerProvider } from './viewer/sdfgViewer';
import { DaCeInterface } from './daceInterface';
import { TransformationsProvider } from './transformation/transformations';
import { TransformationHistoryProvider } from './transformation/transformationHistory';
import { OutlineProvider } from './viewer/outline';

export class DaCeVSCode {

    private static INSTANCE = new DaCeVSCode();

    private constructor() { }

    public static getInstance(): DaCeVSCode {
        return this.INSTANCE;
    }

    private context: vscode.ExtensionContext | undefined = undefined;

    private outputChannel: vscode.OutputChannel | undefined;

    private activeEditor: vscode.WebviewPanel | undefined = undefined;
    private activeSdfgFileName: string | undefined = undefined;

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

        // Register the SDFG outline view.
        context.subscriptions.push(OutlineProvider.register(context));

        // Register necessary commands.
        context.subscriptions.push(vscode.commands.registerCommand(
            'transformationView.refreshEntry',
            () => {
                transformationsProvider.refresh();
            }
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'sdfgOutline.refreshEntry',
            () => {
                DaCeVSCode.getInstance().activeEditorSendPost({
                    type: 'refresh_outline',
                });
            }
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'sdfg.applyTransformation',
            (t) => daceInterface.applyTransformation(t)
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'sdfg.previewTransformation',
            (t) => daceInterface.previewTransformation(t)
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'sdfg.previewHistoryPoint',
            (h) => daceInterface.previewHistoryPoint(h)
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'sdfg.applyHistoryPoint',
            (h) => daceInterface.applyHistoryPoint(h)
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'dace.openOptimizerInTerminal',
            () => daceInterface.startDaemonInTerminal()
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'dace.installDace',
            () => {
                const term = vscode.window.createTerminal('Install DaCe');
                term.show();
                term.sendText(
                    'pip install dace'
                );
            }
        ));
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

    public getActiveEditor() {
        return this.activeEditor;
    }

    public getActiveSdfgFileName() {
        return this.activeSdfgFileName;
    }

    public updateActiveSdfg(activeSdfgFileName: string,
                            activeEditor: vscode.WebviewPanel) {
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

    public activeEditorSendPost(message: any) {
        this.getActiveEditor()?.webview.postMessage(message);
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