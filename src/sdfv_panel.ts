import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * SDFV panel wrapper class.
 * This provides a singleton instance of the webview panel used to display the
 * SDFG viewer.
 */
export class SdfvPanel {

    // The currently active panel. Tracked to only allow a single instance
    // concurently.
    public static currentPanel: SdfvPanel | undefined;

    public static readonly viewType = 'SDFV';

    // Identifiers for code placement into the webview's HTML.
    private readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;
    private readonly jsonIdentifier = '{{ SDFG_JSON }}';
    private readonly fnameIdentifier = '{{ FILE_NAME }}';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionPath: string;
    private _file: vscode.TextDocument;
    private _disposables: vscode.Disposable[] = [];


    /**
     * Constructor.
     * Registers event handlers for the panel.
     * @param panel         Webview panel to bind the instance to
     * @param extensionPath Extension's file-system path
     * @param file          File to bind this panel to
     */
    private constructor(panel: vscode.WebviewPanel,
                        extensionPath: string,
                        file: vscode.TextDocument) {
        this._panel = panel;
        this._extensionPath = extensionPath;
        this._file = file;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Show any existing panel instance or create a new one if there is none.
     * @param extensionPath Extension's file-system path
     * @param file          File to bind this instance to
     */
    public static createOrShow(context: vscode.ExtensionContext,
                               file: vscode.TextDocument) {
        const column = vscode.ViewColumn.Beside;

        context.workspaceState.update('associatedSdfgFile', file);

        if (SdfvPanel.currentPanel) {
            // If an existing panel already references the currently active
            // file, we don't do anything.
            if (SdfvPanel.currentPanel._file.fileName !== file.fileName) {
                // If an existing panel references a different file, update its
                // reference and bring it to the foreground.
                SdfvPanel.currentPanel._file = file;
                SdfvPanel.currentPanel._panel.reveal(column);
            } else {
                if (SdfvPanel.currentPanel._panel.visible)
                    SdfvPanel.currentPanel._update();
            }
        } else {
            // There's no existing panel, create and show a new one.
            const panel = vscode.window.createWebviewPanel(
                SdfvPanel.viewType,
                'SDFG Viewer',
                column,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.file(path.join(
                            context.extensionPath, 'media'
                        ))
                    ],
                    retainContextWhenHidden: true,
                }
            );

            SdfvPanel.currentPanel = new SdfvPanel(
                panel,
                context.extensionPath,
                file
            );
        }
    }

    /**
     * Check if a closed file is bound to the current panel and close it if so.
     * @param context Current extension context
     * @param file    The file that was just closed
     */
    public static checkAssociatedFileClosed(context: vscode.ExtensionContext,
                                            file: vscode.TextDocument) {
        if (SdfvPanel.currentPanel && SdfvPanel.currentPanel._file === file)
            SdfvPanel.currentPanel.dispose();
    }

    /**
     * Revive an existing panel after losing control of it.
     * Creates and binds a new instance.
     * @param panel         Panel to be revived
     * @param extensionPath Path the extension lives in
     * @param file          File to bind to the revived extension
     */
    public static revive(panel: vscode.WebviewPanel,
                         extensionPath: string,
                         file: vscode.TextDocument) {
        SdfvPanel.currentPanel = new SdfvPanel(panel, extensionPath, file);
    }

    /**
     * Close the panel, which destroys and disposes of it.
     * Performs the necessary cleanup operations.
     */
    public dispose() {
        SdfvPanel.currentPanel = undefined;

        this._panel.dispose();

        // Clean up the ressources in the panel.
        while (this._disposables.length) {
            const disposableItem = this._disposables.pop();
            if (disposableItem)
                disposableItem.dispose();
        }
    }

    /**
     * Perform a panel update.
     */
    public _update() {
        const webview = this._panel.webview;

        // Load the base HTML we want to display in the webview.
        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            this._extensionPath, 'media', 'sdfv_base_layout.html'
        ));
        let baseHtml = fs.readFileSync(fpBaseHtml.fsPath, 'utf8');

        // Set the media base-path in the HTML, to load scripts etc..
        const fpMediaFolder: vscode.Uri = vscode.Uri.file(
            path.join(this._extensionPath, 'media')
        );
        const mediaFolderUri = webview.asWebviewUri(fpMediaFolder);
        baseHtml = baseHtml.replace(
            this.csrSrcIdentifier, mediaFolderUri.toString()
        );

        // Place the bound file's name and contents into the HTML so our SDFV
        // script(s) can utilize it.
        let contents: string = this._file.getText();
        if (contents) {
            contents = contents.replace(/\\/g, '\\\\');
            if (/\r|\n/.exec(contents))
                contents = JSON.stringify(JSON.parse(contents));
            baseHtml = baseHtml.replace(this.jsonIdentifier, contents);
        } else {
            baseHtml = baseHtml.replace(this.jsonIdentifier, '');
        }
        const fUri: string = this._file.uri.toString();
        const fName = fUri.substr(fUri.lastIndexOf('/') + 1);
        baseHtml = baseHtml.replace(this.fnameIdentifier, fName);

        webview.html = baseHtml;
    }

}