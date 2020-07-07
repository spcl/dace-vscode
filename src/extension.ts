import * as vscode from 'vscode';

import { SdfgViewerProvider } from './sdfg_viewer';
import { TransformationsProvider } from './transformationsProvider';

/**
 * Activates the plugin, called when VSCode first loads up.
 * @param context The extension context to load into.
 */
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(SdfgViewerProvider.register(context));

    const transformationsProvider = new TransformationsProvider(context);
    vscode.window.registerTreeDataProvider(
        'transformationView',
        transformationsProvider
    );
}

/**
 * Called when the extension gets deactivated, ie. when VSCode is shut down.
 */
export function deactivate() {
}