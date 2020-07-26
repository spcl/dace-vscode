import * as vscode from 'vscode';

import { SdfgViewerProvider } from './sdfg_viewer';
import { TransformationsProvider } from './transformationsProvider';
import { DaCeInterface } from './daceInterface';
import { TransformationHistoryProvider } from './transformationHistoryProvider';

/**
 * Activates the plugin.
 * @param context The extension context to load into.
 */
export function activate(context: vscode.ExtensionContext) {
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
    const trafoHistoryProvider = TransformationHistoryProvider.getInstance();
    vscode.window.registerTreeDataProvider(
        'transformationHistory',
        trafoHistoryProvider
    );

    // Register the SDFG custom editor.
    context.subscriptions.push(SdfgViewerProvider.register(context));

    // Register necessary commands.
    vscode.commands.registerCommand('transformationView.refreshEntry', () => {
        transformationsProvider.refresh();
    });
    vscode.commands.registerCommand('sdfg.applyTransformation', (t) =>
        daceInterface.applyTransformation(t));
    vscode.commands.registerCommand('sdfg.previewTransformation', (t) =>
        daceInterface.previewTransformation(t));
    vscode.commands.registerCommand('dace.installDace', () => {
        const term = vscode.window.createTerminal('Install DaCe');
        term.show();
        term.sendText('pip install git+https://github.com/spcl/dace.git');
    });
}

/**
 * Called when the extension gets deactivated, ie. when VSCode is shut down.
 */
export function deactivate() {
}