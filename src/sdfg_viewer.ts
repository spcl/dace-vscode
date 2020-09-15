import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

import {
    TransformationsProvider
} from './transformation/transformationsProvider';
import {
    TransformationHistoryProvider
} from './transformation/transformationHistoryProvider';
import { DaCeInterface } from './daceInterface';

class SdfgViewer {

    public constructor(
        public readonly webviewPanel: vscode.WebviewPanel,
        public readonly document: vscode.TextDocument
    ) {}

}

export class SdfgViewerProvider implements vscode.CustomTextEditorProvider {

    public static INSTANCE: SdfgViewerProvider | undefined = undefined;

    public static getInstance(): SdfgViewerProvider | undefined {
        return this.INSTANCE;
    }

    // Identifiers for code placement into the webview's HTML.
    private readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;

    private static readonly viewType = 'sdfgCustom.sdfv';

    private activeSdfgFileName: string | undefined = undefined;
    private activeEditor: vscode.WebviewPanel | undefined  = undefined;

    private daceInterface = DaCeInterface.getInstance();
    private transformationsView = TransformationsProvider.getInstance();
    private trafoHistoryView = TransformationHistoryProvider.getInstance();

    private openEditors: SdfgViewer[] = [];

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        SdfgViewerProvider.INSTANCE = new SdfgViewerProvider(ctx);
        return vscode.window.registerCustomEditorProvider(
            SdfgViewerProvider.viewType, SdfgViewerProvider.INSTANCE
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {
    }

    /**
     * Register the current SDFG file and editor to be the last active editor.
     * 
     * This is an unfortunate workaround because the vscode API does not allow
     * you to grab the currently active editor unless it's a TextEditor.
     * 
     * @param document      Active SDFG document.
     * @param webviewPanel  Active SDFG editor webview panel.
     */
    private updateActiveEditor(document: vscode.TextDocument,
                               webviewPanel: vscode.WebviewPanel): void {
        this.trafoHistoryView.clearHistory();
        this.trafoHistoryView.notifyTreeDataChanged();
        this.transformationsView.clearTransformations();
        this.transformationsView.notifyTreeDataChanged();
        this.activeSdfgFileName = document.fileName;
        this.activeEditor = webviewPanel;
        this.daceInterface.updateActiveSdfg(this.activeSdfgFileName,
            this.activeEditor);
    }

    /**
     * Update the contents of the editor's webview.
     * 
     * This also forces the transformation view to update, if the webview is the
     * last active SDFG editor.
     * 
     * @param document      SDFG document with updated contents.
     * @param webviewPanel  SDFG editor webview panel to update.
     */
    private updateWebview(document: vscode.TextDocument,
                          webviewPanel: vscode.WebviewPanel): void {
        webviewPanel.webview.postMessage({
            type: 'update',
            text: document.getText(),
        });
    }

    /**
     * Callback for when the document changes.
     * 
     * This updates the corresponding webview accordingly.
     * If this is the last active SDFG document, we also force a reload of the
     * attached transformation panel.
     * 
     * @param document      Changed document.
     * @param webviewPanel  Attached webview panel.
     */
    private documentChanged(document: vscode.TextDocument,
                            webviewPanel: vscode.WebviewPanel): void {
        this.trafoHistoryView.clearHistory();
        this.trafoHistoryView.notifyTreeDataChanged();
        this.transformationsView.clearTransformations();
        this.transformationsView.notifyTreeDataChanged();
        this.updateWebview(document, webviewPanel);
        if (this.activeEditor === webviewPanel) {
            this.transformationsView.refresh();
            this.trafoHistoryView.refresh();
        }
    }

    public getOpenEditors() {
        return this.openEditors;
    }

    public findEditorForPanel(
        webviewPanel: vscode.WebviewPanel
    ): SdfgViewer | undefined {
        for (const element of this.openEditors) {
            if (element.webviewPanel === webviewPanel)
                return element;
        }
        return undefined;
    }

    public removeOpenEditor(webviewPanel: vscode.WebviewPanel) {
        const editor = this.findEditorForPanel(webviewPanel);
        if (editor)
            this.openEditors.splice(this.openEditors.indexOf(editor), 1);
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Add this editor to the list of all editors.
        this.openEditors.push(new SdfgViewer(webviewPanel, document));

        // Make sure that if the webview (editor) gets closed again, we remove
        // it from the open editors list.
        webviewPanel.onDidDispose(() => {
            SdfgViewerProvider.getInstance()?.removeOpenEditor(webviewPanel);
        });

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'media'
                ))
            ],
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        // We want to track the last active SDFG viewer/file.
        if (webviewPanel.active)
            this.updateActiveEditor(document, webviewPanel);
        // Store a ref to the document if it becomes active.
        webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.active)
                this.updateActiveEditor(document, webviewPanel);
        });

        // Register an event listener for when the document changes on disc.
        // We want to update our webview if that happens.
        const docChangeSubs = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString())
                this.documentChanged(document, webviewPanel);
        });
        // Get rid of it when the editor closes.
        webviewPanel.onDidDispose(() => {
            docChangeSubs.dispose();
        });

        // Handle received messages from the webview.
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'sortTransformations':
                    const viewElements = JSON.parse(e.visibleElements);
                    const selectedElements = JSON.parse(e.selectedElements);
                    if (viewElements && selectedElements)
                        TransformationsProvider.getInstance()
                            .sortTransformations(viewElements, selectedElements);
                    break;
                case 'getCurrentSdfg':
                    const instance = SdfgViewerProvider.getInstance();
                    if (instance) {
                        const editor: SdfgViewer | undefined =
                            instance.findEditorForPanel(webviewPanel);
                        if (editor !== undefined)
                            this.updateWebview(editor.document, webviewPanel);
                    }
                    break;
                case 'gotoSource':
                    // We want to jump to a specific file and location if it
                    // exists.
                    let filePath: string;
                    if (path.isAbsolute(e.file_path))
                        filePath = e.file_path;
                    else
                        filePath = path.normalize(
                            vscode.workspace.rootPath + '/' + e.file_path
                        );
                    if (fs.existsSync(filePath)) {
                        // The file exists, load it and show it in a new
                        // editor, highlighting the indicated range.
                        const fileUri: vscode.Uri = vscode.Uri.file(filePath);
                        vscode.workspace.openTextDocument(fileUri).then(
                            (doc: vscode.TextDocument) => {
                                const startPos = new vscode.Position(
                                    e.startRow, e.startChar
                                );
                                const endPos = new vscode.Position(
                                    e.endRow, e.endChar
                                );
                                const range = new vscode.Range(
                                    startPos, endPos
                                );
                                vscode.window.showTextDocument(
                                    doc, {
                                        preview: true,
                                        selection: range,
                                    }
                                );
                            }
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            'Could not find file ' + filePath
                        );
                    }
                    return;
            }
        });

        this.updateWebview(document, webviewPanel);
        webviewPanel.reveal();
    }

    /**
     * Load the HTML to be displayed in the editor's webview.
     * 
     * @param webview  Webview to load for
     * @param document Document to show in the editor's webview
     * 
     * @returns        HTML to be displayed
     */
    private getHtml(webview: vscode.Webview): string {
        // Load the base HTML we want to display in the webview/editor.
        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath, 'media', 'sdfv_base_layout.html'
        ));
        let baseHtml = fs.readFileSync(fpBaseHtml.fsPath, 'utf8');

        // Set the media base-path in the HTML, to load scripts and styles.
        const fpMediaFolder: vscode.Uri = vscode.Uri.file(
            path.join(this.context.extensionPath, 'media')
        );
        const mediaFolderUri = webview.asWebviewUri(fpMediaFolder);
        baseHtml = baseHtml.replace(
            this.csrSrcIdentifier, mediaFolderUri.toString()
        );

        return baseHtml;
    }

}
