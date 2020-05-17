import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

export class SdfgViewerProvider implements vscode.CustomTextEditorProvider {

    // Identifiers for code placement into the webview's HTML.
    private readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;
    private readonly jsonIdentifier = '{{ SDFG_JSON }}';
    private readonly fnameIdentifier = '{{ FILE_NAME }}';

    private static readonly viewType = 'sdfgCustom.sdfv';

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            SdfgViewerProvider.viewType, new SdfgViewerProvider(ctx)
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {
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

        function updateWebview() {
            webviewPanel.webview.postMessage({
                type: 'update',
                text: document.getText(),
            });
        }

        // Register an event listener for when the document changes on disc.
        // We want to update our webview if that happens.
        const docChangeSubs = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString())
                updateWebview();
        });
        // Get rid of it when the editor closes.
        webviewPanel.onDidDispose(() => {
            docChangeSubs.dispose();
        });

        // Handle received messages from the webview.
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
            }
        });

        updateWebview();
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