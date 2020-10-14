import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

import {
    TransformationsProvider
} from '../transformation/transformations';
import {
    TransformationHistoryProvider
} from '../transformation/transformationHistory';
import { DaCeInterface } from '../daceInterface';
import { OutlineProvider } from './outline';
import { DaCeVSCode } from '../extension';
import { SymbolResolutionProvider } from './symbolResolution';
import { BaseComponent } from './baseComponent';
import { ComponentMessageHandler } from './messaging/componentMessageHandler';

class SdfgViewer {

    public constructor(
        public readonly webview: vscode.Webview,
        public readonly document: vscode.TextDocument
    ) {}

}

export class SdfgViewerProvider
extends BaseComponent
implements vscode.CustomTextEditorProvider {

    public static INSTANCE: SdfgViewerProvider | undefined = undefined;

    public static getInstance(): SdfgViewerProvider | undefined {
        return this.INSTANCE;
    }

    // Identifiers for code placement into the webview's HTML.
    private readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;

    private static readonly viewType = 'sdfgCustom.sdfv';

    private activeSdfgFileName: string | undefined = undefined;
    private activeEditor: vscode.Webview | undefined  = undefined;

    private daceInterface = DaCeInterface.getInstance();
    private transformationsView = TransformationsProvider.getInstance();
    private trafoHistoryView = TransformationHistoryProvider.getInstance();

    private openEditors: SdfgViewer[] = [];

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        SdfgViewerProvider.INSTANCE = new SdfgViewerProvider(ctx);
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
        OutlineProvider.getInstance()?.clearOutline();
        SymbolResolutionProvider.getInstance()?.clearSymbols();
        this.trafoHistoryView.clearHistory();
        this.trafoHistoryView.notifyTreeDataChanged();
        this.transformationsView.clearTransformations();
        this.transformationsView.notifyTreeDataChanged();
        this.activeSdfgFileName = document.fileName;
        this.activeEditor = webview;
        DaCeVSCode.getInstance().updateActiveSdfg(this.activeSdfgFileName,
            this.activeEditor);
        OutlineProvider.getInstance()?.refresh();
        SymbolResolutionProvider.getInstance()?.refresh();
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
                          webview: vscode.Webview): void {
        webview.postMessage({
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
     * @param webview       Attached webview.
     */
    private documentChanged(document: vscode.TextDocument,
                            webview: vscode.Webview): void {
        OutlineProvider.getInstance()?.clearOutline();
        SymbolResolutionProvider.getInstance()?.clearSymbols();
        this.trafoHistoryView.clearHistory();
        this.trafoHistoryView.notifyTreeDataChanged();
        this.transformationsView.clearTransformations();
        this.transformationsView.notifyTreeDataChanged();
        this.updateWebview(document, webview);
        if (this.activeEditor === webview) {
            this.transformationsView.refresh();
            this.trafoHistoryView.refresh();
            OutlineProvider.getInstance()?.refresh();
            SymbolResolutionProvider.getInstance()?.refresh();
        }
    }

    public getOpenEditors() {
        return this.openEditors;
    }

    public findEditorForWebview(
        webview: vscode.Webview
    ): SdfgViewer | undefined {
        for (const element of this.openEditors) {
            if (element.webview === webview)
                return element;
        }
        return undefined;
    }

    public removeOpenEditor(webview: vscode.Webview) {
        const editor = this.findEditorForWebview(webview);
        if (editor)
            this.openEditors.splice(this.openEditors.indexOf(editor), 1);
    }

    public handleMessage(message: any, origin: vscode.Webview): void {
        switch (message.type) {
            case 'sort_transformations':
                const viewElements = JSON.parse(message.visibleElements);
                const selectedElements = JSON.parse(message.selectedElements);
                if (viewElements && selectedElements)
                    TransformationsProvider.getInstance()
                        .sortTransformations(viewElements, selectedElements);
                break;
            case 'get_current_sdfg':
                const instance = SdfgViewerProvider.getInstance();
                if (instance && origin) {
                    const editor: SdfgViewer | undefined =
                        instance.findEditorForWebview(origin);
                    if (editor !== undefined)
                        this.updateWebview(editor.document, origin);
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
                if (fs.existsSync(filePath)) {
                    // The file exists, load it and show it in a new
                    // editor, highlighting the indicated range.
                    const fileUri: vscode.Uri = vscode.Uri.file(filePath);
                    vscode.workspace.openTextDocument(fileUri).then(
                        (doc: vscode.TextDocument) => {
                            const startPos = new vscode.Position(
                                message.startRow, message.startChar
                            );
                            const endPos = new vscode.Position(
                                message.endRow, message.endChar
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
                break;
            case 'update_badness_scale_method':
            case 'symbol_value_changed':
            case 'refresh_outline':
            case 'refresh_symbol_list':
                this.activeEditor?.postMessage(message);
                break;
            default:
                break;
        }
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
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        // We want to track the last active SDFG viewer/file.
        if (webviewPanel.active)
            this.updateActiveEditor(document, webviewPanel.webview);
        // Store a ref to the document if it becomes active.
        webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.active)
                this.updateActiveEditor(document, webviewPanel.webview);
        });

        // Register an event listener for when the document changes on disc.
        // We want to update our webview if that happens.
        const docChangeSubs = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString())
                this.documentChanged(document, webviewPanel.webview);
        });
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
            this.context.extensionPath,
            'media',
            'components',
            'sdfv',
            'index.html'
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

        // If the settings indicate it, split the webview vertically and put
        // the info container to the right instead of at the bottom.
        if (vscode.workspace.getConfiguration(
                'dace.sdfv'
            ).layout === 'vertical'
        ) {
            baseHtml = baseHtml.replace(
                '<div id="split-container">',
                '<div id="split-container" style="display: flex;">'
            );
            baseHtml = baseHtml.replace(
                'direction: \'vertical\',',
                'direction: \'horizontal\','
            );
        }

        return baseHtml;
    }

}
