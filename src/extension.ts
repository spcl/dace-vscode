import * as vscode from 'vscode';

import { SdfgViewerProvider } from './sdfg_viewer';
import { TransformationsProvider } from './transformationsProvider';

/**
 * Activates the plugin.
 * @param context The extension context to load into.
 */
export function activate(context: vscode.ExtensionContext) {
    // Create and register the transformations view.
    const transformationsProvider = TransformationsProvider.getInstance();
    vscode.window.registerTreeDataProvider(
        'transformationView',
        transformationsProvider
    );

    // Register the SDFG custom editor.
    context.subscriptions.push(SdfgViewerProvider.register(context));

    /*
    vscode.window.registerTreeDataProvider(
        'transformationHistory',
        transformationsProvider
    );
    */

    // Register necessary commands.
    vscode.commands.registerCommand('transformationView.refreshEntry', () => {
        transformationsProvider.refresh();
    });
    vscode.commands.registerCommand('sdfg.applyTransformation', (t) =>
        transformationsProvider.applyTransformation(t));
    vscode.commands.registerCommand('sdfg.previewTransformation', (t) =>
        transformationsProvider.previewTransformation(t));
    vscode.commands.registerCommand('dace.installDace', () => {
        const term = vscode.window.createTerminal('Install DaCe');
        term.show();
        term.sendText('pip install dace');
    });
}

/**
 * Called when the extension gets deactivated, ie. when VSCode is shut down.
 */
export function deactivate() {
}