import * as vscode from 'vscode';

import { SdfvPanel } from './sdfv_panel';

/**
 * Activates the plugin, called when VSCode first loads up.
 * @param context The extension context to load into.
 */
export function activate(context: vscode.ExtensionContext) {
    const window = vscode.window;
    const workspace = vscode.workspace;

    // Register a serializer to re-attach to an open panel if the workspace is
    // restored after closing it.
    vscode.window.registerWebviewPanelSerializer(
        SdfvPanel.viewType,
        {
            async deserializeWebviewPanel(
                webviewPanel: vscode.WebviewPanel,
                state: any
            ) {
                let file: vscode.TextDocument | undefined =
                    context.workspaceState.get('associatedSdfgFile');
                if (file) {
                    for (let f of workspace.textDocuments) {
                        if (f.fileName === file.fileName) {
                            file = f;
                            break;
                        }
                    }
                    SdfvPanel.revive(webviewPanel, context.extensionPath, file);
                }
            }
        }
    );

    // Register a listener for when text documents are opened.
    context.subscriptions.push(workspace.onDidOpenTextDocument(e => {
        if (e)
            checkOpenSdfvPanel(e, context);
    }));

    // Register a listener for when a different text document/editor receives
    // focus.
    context.subscriptions.push(window.onDidChangeActiveTextEditor(e => {
        if (e)
            checkOpenSdfvPanel(e.document, context);
    }));

    // Register a listener for when text documents are closed.
    context.subscriptions.push(workspace.onDidCloseTextDocument(e => {
        if (e)
            checkCloseSdfvPanel(e, context);
    }));
    
    /*
    context.subscriptions.push(workspace.onDidChangeTextDocument(e => {
    }));
    */

    context.subscriptions.push(workspace.onDidSaveTextDocument(e => {
        if (e)
            checkOpenSdfvPanel(e, context);
    }));
}

/**
 * Called when the extension gets deactivated, ie. when VSCode is shut down.
 */
export function deactivate() {
}

/**
 * Check if the SDFV panel needs to be shown because a valid SDFG was opened.
 * @param document The text document that was just openend
 * @param context  Current extension context
 */
export function checkOpenSdfvPanel(document: vscode.TextDocument,
                                   context: vscode.ExtensionContext) {
    if (document.fileName.endsWith('.sdfg')) {
        // This is declared as an SDFG File, let's try to open it as such.
        SdfvPanel.createOrShow(context, document);
    }
}

/**
 * Propagate a file-close-event to the SDFV panel for handling.
 * @param document The text document that was just closed.
 * @param context  Current extension context
 */
export function checkCloseSdfvPanel(document: vscode.TextDocument,
                                    context: vscode.ExtensionContext) {
    SdfvPanel.checkAssociatedFileClosed(context, document);
}