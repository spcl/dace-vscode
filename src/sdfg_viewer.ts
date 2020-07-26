import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

import { TransformationsProvider } from './transformationsProvider';
import { DaCeInterface } from './daceInterface';
import { TransformationHistoryProvider } from './transformationHistoryProvider';

export class SdfgViewerProvider implements vscode.CustomTextEditorProvider {

    // Identifiers for code placement into the webview's HTML.
    private readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;
    private readonly jsonIdentifier = '{{ SDFG_JSON }}';
    private readonly fnameIdentifier = '{{ FILE_NAME }}';

    private static readonly viewType = 'sdfgCustom.sdfv';

    private activeSdfgFileName: string | undefined = undefined;
    private activeEditor: vscode.WebviewPanel | undefined  = undefined;

    private daceInterface = DaCeInterface.getInstance();
    private transformationsView = TransformationsProvider.getInstance();
    private trafoHistoryView = TransformationHistoryProvider.getInstance();

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            SdfgViewerProvider.viewType, new SdfgViewerProvider(ctx)
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
        this.updateWebview(document, webviewPanel);
        if (this.activeEditor === webviewPanel) {
            this.transformationsView.refresh();
            this.trafoHistoryView.refresh();
        }
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'media'
                ))
            ],
        };
        webviewPanel.webview.html = this.getHtml(
            webviewPanel.webview,
            document
        );

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
                case 'exitPreview':
                    console.log(webviewPanel);
                    console.log('is trying to exit');
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
    private getHtml(webview: vscode.Webview,
        document: vscode.TextDocument): string {
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

        // Place the bound file's name and contents into the HTML so our SDFV
        // script(s) can utilize it.
        let contents: string = document.getText();
        if (contents) {
            contents = contents.replace(/\\/g, '\\\\');
            if (/\r|\n/.exec(contents))
                contents = JSON.stringify(JSON.parse(contents));
            baseHtml = baseHtml.replace(this.jsonIdentifier, contents);
        } else {
            baseHtml = baseHtml.replace(this.jsonIdentifier, '');
        }
        const fUri: string = document.uri.toString();
        const fName = fUri.substr(fUri.lastIndexOf('/') + 1);
        baseHtml = baseHtml.replace(this.fnameIdentifier, fName);

        return baseHtml;
    }

}
