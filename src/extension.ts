import * as vscode from 'vscode';

import { SdfgViewerProvider } from './sdfg_viewer';
import { DaCeInterface } from './daceInterface';
import { TransformationsProvider } from './transformation/transformationsProvider';
import { TransformationHistoryProvider } from './transformation/transformationHistoryProvider';

export class DaCeVSCode {

    private static INSTANCE = new DaCeVSCode();

    private constructor() { }

    public static getInstance(): DaCeVSCode {
        return this.INSTANCE;
    }

    private context: vscode.ExtensionContext | undefined = undefined;

    private outputChannel: vscode.OutputChannel | undefined;

    public init(context: vscode.ExtensionContext) {
        this.context = context;

        // Connect to DaCe.
        const daceInterface = DaCeInterface.getInstance();
        daceInterface.start();

        // Create and register the transformations view.
        const transformationsProvider = TransformationsProvider.getInstance();
        vscode.window.registerTreeDataProvider(
            'transformationView',
            transformationsProvider
        );

        // Create and register the view for the transformation history.
        const trafoHistoryProvider =
            TransformationHistoryProvider.getInstance();
        vscode.window.registerTreeDataProvider(
            'transformationHistory',
            trafoHistoryProvider
        );

        // Register the SDFG custom editor.
        context.subscriptions.push(SdfgViewerProvider.register(context));

        // Register necessary commands.
        vscode.commands.registerCommand('transformationView.refreshEntry',
            () => {
                transformationsProvider.refresh();
            }
        );
        vscode.commands.registerCommand('sdfg.applyTransformation', (t) =>
            daceInterface.applyTransformation(t));
        vscode.commands.registerCommand('sdfg.previewTransformation', (t) =>
            daceInterface.previewTransformation(t));
        vscode.commands.registerCommand('sdfg.previewHistoryPoint', (h) =>
            daceInterface.previewHistoryPoint(h));
        vscode.commands.registerCommand('sdfg.applyHistoryPoint', (h) =>
            daceInterface.applyHistoryPoint(h));
        vscode.commands.registerCommand('dace.openOptimizerInTerminal', () =>
            daceInterface.startDaemonInTerminal());
        vscode.commands.registerCommand('dace.installDace', () => {
            const term = vscode.window.createTerminal('Install DaCe');
            term.show();
            term.sendText('pip install git+https://github.com/spcl/dace.git');
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