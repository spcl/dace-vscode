// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';

import { TransformationHistoryProvider } from './transformationHistory';
import { OutlineProvider } from './outline';
import { DaCeVSCode } from '../extension';
import { AnalysisProvider } from './analysis';
import { BaseComponent } from './baseComponent';
import { ComponentMessageHandler } from './messaging/componentMessageHandler';
import { TransformationListProvider } from './transformationList';
import { BreakpointHandler, getCppRange, Node } from '../debugger/breakpointHandler';

export class SdfgViewer {

    public constructor(
        public readonly webview: vscode.Webview,
        public readonly document: vscode.TextDocument
    ) { }

    public wrapperFile?: string = undefined;
    public argv?: string[] = undefined;
    public linkFile?: string = undefined;

}

export class SdfgViewerProvider
    extends BaseComponent
    implements vscode.CustomTextEditorProvider {

    public static INSTANCE: SdfgViewerProvider | undefined = undefined;

    public static getInstance(): SdfgViewerProvider | undefined {
        return this.INSTANCE;
    }

    private static readonly viewType: string = 'sdfgCustom.sdfv';

    private openEditors: SdfgViewer[] = [];

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        SdfgViewerProvider.INSTANCE = new SdfgViewerProvider(
            ctx,
            this.viewType
        );
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: true,
        };
        return vscode.window.registerCustomEditorProvider(
            SdfgViewerProvider.viewType,
            SdfgViewerProvider.INSTANCE,
            {
                webviewOptions: options
            }
        );
    }

    /**
     * Register the current SDFG file and editor to be the last active editor.
     * 
     * This is an unfortunate workaround because the vscode API does not allow
     * you to grab the currently active editor unless it's a TextEditor.
     * 
     * @param document      Active SDFG document.
     * @param webview       Active SDFG editor webview.
     */
    private updateActiveEditor(document: vscode.TextDocument,
        webview: vscode.Webview): void {
        DaCeVSCode.getInstance().updateActiveSdfg(document.fileName, webview);
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
        webview: vscode.Webview,
        preventRefreshes: boolean = false): void {
        webview.postMessage({
            type: 'update',
            text: document.getText(),
            prevent_refreshes: preventRefreshes,
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
     * @param webview       Attached webview.
     */
    private documentChanged(document: vscode.TextDocument,
        webview: vscode.Webview): void {
        this.updateWebview(document, webview);
        if (DaCeVSCode.getInstance().getActiveEditor() === webview) {
            TransformationListProvider.getInstance()?.refresh();
            TransformationHistoryProvider.getInstance()?.refresh();
            OutlineProvider.getInstance()?.refresh();
            AnalysisProvider.getInstance()?.refresh();
        }
    }

    public getOpenEditors() {
        return this.openEditors;
    }

    public findEditorForWebview(
        webview: vscode.Webview
    ): SdfgViewer | undefined {
        for (const element of this.openEditors)
            if (element.webview === webview)
                return element;
        return undefined;
    }

    public findEditorForPath(uri: vscode.Uri): SdfgViewer | undefined {
        for (const element of this.openEditors)
            if (element.document.uri.toString() === uri.toString())
                return element;
        return undefined;
    }

    public removeOpenEditor(webview: vscode.Webview) {
        const editor = this.findEditorForWebview(webview);
        if (editor)
            this.openEditors.splice(this.openEditors.indexOf(editor), 1);
    }

    public async handleMessage(message: any,
        origin: vscode.Webview | undefined = undefined): Promise<void> {
        let node: any;
        switch (message.type) {
            case 'get_current_sdfg':
                const instance = SdfgViewerProvider.getInstance();
                if (instance !== undefined && origin !== undefined) {
                    const editor: SdfgViewer | undefined =
                        instance.findEditorForWebview(origin);
                    if (editor !== undefined) {
                        if (message.prevent_refreshes)
                            this.updateWebview(editor.document, origin, true);
                        else
                            this.updateWebview(editor.document, origin);
                    }
                }
                break;
            case 'go_to_source':
                // We want to jump to a specific file and location if it
                // exists.
                let filePath: string;
                if (path.isAbsolute(message.file_path))
                    filePath = message.file_path;
                else
                    filePath = path.normalize(
                        vscode.workspace.rootPath + '/' + message.file_path
                    );

                const fileUri: vscode.Uri = vscode.Uri.file(filePath);
                this.goToFileLocation(
                    fileUri,
                    message.startRow,
                    message.startChar,
                    message.endRow,
                    message.endChar
                );
                break;
            case 'go_to_cpp':
                // If the message passes a cache path then use that path, otherwise
                // get the cache directory of the currently opened SDFG
                let cachePath: string = message.cache_path;
                if (!cachePath) {
                    const SdfgFileName = DaCeVSCode.getInstance()
                        .getActiveSdfgFileName();
                    if (!SdfgFileName)
                        return;

                    const sdfgFilePath = vscode.Uri.file(SdfgFileName).fsPath;
                    cachePath = path.dirname(sdfgFilePath);
                }

                let mapPath = path.join(
                    cachePath,
                    'map',
                    'map_cpp.json'
                );

                let cppPath = path.join(
                    cachePath,
                    'src',
                    'cpu',
                    message.sdfg_name + '.cpp'
                );

                const cppMapUri = vscode.Uri.file(mapPath);
                const cppFileUri = vscode.Uri.file(cppPath);
                node = new Node(
                    message.sdfg_id,
                    message.state_id,
                    message.node_id,
                );

                getCppRange(node, cppMapUri).then(lineRange => {
                    // If there is no matching location we just goto the file
                    // without highlighting and indicate it with a message
                    if (!lineRange || !lineRange.from) {
                        lineRange = {};
                        lineRange.from = 1;
                        vscode.window.showInformationMessage(
                            'Could not find a specific line for Node:' +
                            node.printer()
                        );
                    }

                    // Subtract 1 as we don't want to highlight the first line
                    // as the 'to' value is inclusive 
                    if (!lineRange.to) {
                        lineRange.to = lineRange.from - 1;
                    }

                    this.goToFileLocation(
                        cppFileUri,
                        lineRange.from - 1,
                        0,
                        lineRange.to,
                        0
                    );
                });
                break;
            case 'go_to_sdfg':
                SdfgViewerProvider.getInstance()?.openViewer(
                    vscode.Uri.file(message.path),
                    message.zoom_to,
                    message.display_bps
                );
                break;
            default:
                DaCeVSCode.getInstance().getActiveEditor()?.postMessage(message);
                break;
        }
    }

    public goToFileLocation(
        fileUri: vscode.Uri,
        startLine: number,
        startCol: number,
        endLine: number,
        endCol: number
    ) {
        /* Load the file and show it in a new editor, highlighting the
        indicated range. */
        vscode.workspace.openTextDocument(fileUri).then(
            (doc: vscode.TextDocument) => {

                const startPos = new vscode.Position(
                    startLine, startCol
                );
                const endPos = new vscode.Position(
                    endLine, endCol
                );
                const range = new vscode.Range(
                    startPos, endPos
                );
                vscode.window.showTextDocument(
                    doc, {
                    preview: false,
                    selection: range,
                }
                );
            }, (reason) => {
                vscode.window.showInformationMessage(
                    'Could not open file ' + fileUri.fsPath + ', ' + reason
                );
            }
        );
    }

    public openViewer(uri: vscode.Uri, zoom_to: string | undefined = undefined,
        display_bps: boolean = false) {
        vscode.commands.executeCommand("vscode.openWith", uri, SdfgViewerProvider.viewType).then(_ => {
            if (zoom_to)
                this.handleMessage({
                    type: 'zoom_to_node',
                    uuid: zoom_to,
                });
            if (display_bps)
                this.handleMessage({
                    type: 'display_breakpoints',
                    display: display_bps
                });
        });
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Add this editor to the list of all editors.
        this.openEditors.push(new SdfgViewer(webviewPanel.webview, document));

        // Make sure that if the webview (editor) gets closed again, we remove
        // it from the open editors list.
        webviewPanel.onDidDispose(() => {
            SdfgViewerProvider.getInstance()?.removeOpenEditor(
                webviewPanel.webview
            );
        });

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'media'
                ))
            ],
        };
        this.getHtml(webviewPanel.webview).then((html) => {
            webviewPanel.webview.html = html;

            // We want to track the last active SDFG viewer/file.
            if (webviewPanel.active)
                this.updateActiveEditor(document, webviewPanel.webview);
            // Store a ref to the document if it becomes active.
            webviewPanel.onDidChangeViewState(e => {
                if (e.webviewPanel.active)
                    this.updateActiveEditor(document, webviewPanel.webview);
                else
                    DaCeVSCode.getInstance().clearActiveSdfg();
            });

            // Register an event listener for when the document changes on disc.
            // We want to update our webview if that happens.
            const docChangeSubs = vscode.workspace.onDidChangeTextDocument(
                e => {
                    if (e.document.uri.toString() === document.uri.toString() &&
                        e.contentChanges.length > 0)
                        this.documentChanged(document, webviewPanel.webview);
                }
            );
            // Get rid of it when the editor closes.
            webviewPanel.onDidDispose(() => {
                docChangeSubs.dispose();
            });

            // Handle received messages from the webview.
            webviewPanel.webview.onDidReceiveMessage(message => {
                ComponentMessageHandler.getInstance().handleMessage(
                    message,
                    webviewPanel.webview
                );
            });

            this.updateWebview(document, webviewPanel.webview);
            webviewPanel.reveal();
        });
    }

    /**
     * Load the HTML to be displayed in the editor's webview.
     * 
     * @param webview  Webview to load for
     * @param document Document to show in the editor's webview
     * 
     * @returns        HTML to be displayed
     */
    private async getHtml(webview: vscode.Webview): Promise<string> {
        // Load the base HTML we want to display in the webview/editor.
        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath,
            'media',
            'components',
            'sdfv',
            'index.html'
        ));
        let baseHtml = (
            await vscode.workspace.fs.readFile(fpBaseHtml)
        ).toString();

        // Set the media base-path in the HTML, to load scripts and styles.
        const fpMediaFolder: vscode.Uri = vscode.Uri.file(
            path.join(this.context.extensionPath, 'media')
        );
        const mediaFolderUri = webview.asWebviewUri(fpMediaFolder);
        baseHtml = baseHtml.replace(
            this.csrSrcIdentifier, mediaFolderUri.toString()
        );

        // If the settings indicate it, split the webview vertically and put
        // the info container to the right instead of at the bottom.
        if (vscode.workspace.getConfiguration(
            'dace.sdfv'
        ).layout === 'vertical'
        ) {
            baseHtml = baseHtml.replace(
                '<div id="split-container" class="split-container-vertical">',
                '<div id="split-container" style="display: flex;" class="split-container-horizontal">'
            );
            baseHtml = baseHtml.replace(
                'direction: \'vertical\',',
                'direction: \'horizontal\','
            );
        }

        return baseHtml;
    }

}
