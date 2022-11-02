// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from '../dace_interface';

import { BreakpointHandler, getCppRange, SDFGDebugNode } from '../debugger/breakpoint_handler';
import { DaCeVSCode } from '../extension';
import { fileExists } from '../utils/utils';
import { AnalysisProvider } from './analysis';
import { BaseComponent } from './base_component';
import {
    ICPCExtensionMessagingComponent
} from './messaging/icpc_extension_messaging_component';
import { OutlineProvider } from './outline';
import { TransformationHistoryProvider } from './transformation_history';
import { TransformationListProvider } from './transformation_list';

class ProcedureCall {

    constructor(
        private readonly sdfgName: string,
        private readonly messageHandler: ICPCExtensionMessagingComponent,
        private readonly procedure: string,
        private readonly args?: any[],
    ) { }

    public async execute(): Promise<any> {
        return this.messageHandler.invoke(this.procedure, this.args);
    }

    public async checkExecute(sdfgName: string): Promise<boolean> {
        // Sends the msg if it corresponds to the SDFG and is not outdated
        // Returns true if the Message can be deleted
        if (sdfgName === this.sdfgName) {
            this.execute();
            return true;
        }
        return false;
    }

}

export class SdfgViewer {

    public constructor(
        public readonly webview: vscode.Webview,
        public readonly document: vscode.TextDocument
    ) { }

    public wrapperFile?: string;
    public argv?: string[];
    public linkFile?: string;
    public messageHandler?: ICPCExtensionMessagingComponent;

}

export class SdfgViewerProvider
    extends BaseComponent
    implements vscode.CustomTextEditorProvider {

    public static readonly COMPONENT_NAME = 'sdfv';

    public static INSTANCE: SdfgViewerProvider | undefined = undefined;

    private queuedProcedureCalls: ProcedureCall[] = [];

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
    private updateActiveEditor(
        editor: SdfgViewer, document: vscode.TextDocument,
        webview: vscode.Webview
    ): void {
        DaCeVSCode.getInstance().updateActiveSdfg(
            editor, document.fileName, webview
        );
    }

    /**
     * Update the contents of the editor's webview.
     *
     * This also forces the transformation view to update, if the webview is the
     * last active SDFG editor.
     */
    public updateEditor(
        editor: SdfgViewer, preventRefreshes: boolean = false
    ): void {
        editor.messageHandler?.invoke(
            'updateContents', [editor.document.getText(), preventRefreshes]
        );
    }

    /**
     * Callback for when the document changes.
     *
     * This updates the corresponding webview accordingly.
     * If this is the last active SDFG document, we also force a reload of the
     * attached transformation panel.
     */
    private documentChanged(editor: SdfgViewer): void {
        this.updateEditor(editor);
        if (DaCeVSCode.getInstance().getActiveEditor() === editor) {
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

    public removeOpenEditor(document: vscode.TextDocument) {
        const editor = this.findEditorForPath(document.uri);
        if (editor)
            this.openEditors.splice(this.openEditors.indexOf(editor), 1);
    }

    public disableMinimap(): void {
        vscode.workspace.getConfiguration('dace.sdfv')?.update(
            'minimap', false
        ).then(() => {
            vscode.window.showInformationMessage(
                'Minimap disabled, you can re-enable the feature in ' +
                'your settings.'
            );
        });
    }

    public setSplitDirection(dir?: 'vertical' | 'horizontal'): void {
        vscode.workspace.getConfiguration('dace.sdfv')?.update('layout', dir);
    }

    public requestUpdateEditor(
        editor: SdfgViewer, preventRefreshes: boolean = false
    ): void {
        this.updateEditor(editor, preventRefreshes);
    }

    public async setOutline(outlineList: any[]): Promise<void> {
        return OutlineProvider.getInstance()?.setOutline(outlineList);
    }

    public async goToSource(
        pFilePath: string, startRow: number, startChar: number, endRow: number,
        endChar: number
    ): Promise<void> {
        // We want to jump to a specific file and location if it exists.
        let fPath: vscode.Uri | null = null;
        if (path.isAbsolute(pFilePath)) {
            fPath = vscode.Uri.file(pFilePath);
        } else if (vscode.workspace.workspaceFolders) {
            // If the provided path is relative, search through the open
            // workspace folders to see if one contains a file at the
            // provided relative path.
            for (const wsFolder of vscode.workspace.workspaceFolders) {
                const filePathCandidate = vscode.Uri.joinPath(
                    wsFolder.uri, pFilePath
                );
                if (await fileExists(filePathCandidate)) {
                    fPath = filePathCandidate;
                    break;
                }
            }
        } else {
            vscode.window.showErrorMessage(
                'Cannot jump to the relative path ' + pFilePath +
                ' without a folder open in VSCode.'
            );
            return;
        }

        if (fPath)
            this.goToFileLocation(fPath, startRow, startChar, endRow, endChar);
    }

    public async goToCPP(
        sdfgName: string, sdfgId: number, stateId: number, nodeId: number,
        cachePath?: string,
    ): Promise<void> {
        // If the message passes a cache path then use that path,
        // otherwise reconstruct the folder based on the default cache
        // directory with respect to the opened workspace folder and the
        // SDFG name.
        let cacheUri: vscode.Uri | null = null;
        const cPath: string = cachePath ?? path.join(
            '.', '.dacecache', sdfgName
        );
        if (path.isAbsolute(cPath)) {
            cacheUri = vscode.Uri.file(cPath);
        } else if (vscode.workspace.workspaceFolders) {
            // If the provided path is relative, search through the open
            // workspace folders to see if one contains a file at the
            // provided relative path.
            for (const wsFolder of vscode.workspace.workspaceFolders) {
                const cacheUriCandidate = vscode.Uri.joinPath(
                    wsFolder.uri, cPath
                );
                if (await fileExists(cacheUriCandidate)) {
                    cacheUri = cacheUriCandidate;
                    break;
                }
            }
        } else {
            vscode.window.showErrorMessage(
                'Cannot jump to the relative path ' + cPath +
                'without a folder open in VSCode.'
            );
            return;
        }

        if (!cacheUri)
            return;

        const cppMapUri = vscode.Uri.joinPath(
            cacheUri, 'map', 'map_cpp.json'
        );
        const cppFileUri = vscode.Uri.joinPath(
            cacheUri, 'src', 'cpu', sdfgName + '.cpp'
        );
        const node = new SDFGDebugNode(sdfgId, stateId, nodeId);

        getCppRange(node, cppMapUri).then(lineRange => {
            // If there is no matching location we just goto the file
            // without highlighting and indicate it with a message
            if (!lineRange || !lineRange.from) {
                lineRange = { to: Number.MAX_VALUE, from: 0 };
                lineRange.from = 1;
                vscode.window.showInformationMessage(
                    'Could not find a specific line for Node:' +
                    node.printer()
                );
            }

            // Subtract 1 as we don't want to highlight the first line
            // as the 'to' value is inclusive
            if (!lineRange.to)
                lineRange.to = lineRange.from - 1;

            this.goToFileLocation(
                cppFileUri, lineRange.from - 1, 0, lineRange.to, 0
            );
        });
    }

    public async goToSDFG(
        zoomTo: string, sdfgName: string, filePath: string,
        displayBps: boolean = false
    ): Promise<void> {
        const activeEditor = DaCeVSCode.getInstance().getActiveEditor();
        const calls = [];
        if (zoomTo && activeEditor?.messageHandler) {
            calls.push(new ProcedureCall(
                sdfgName, activeEditor.messageHandler, 'zoomToNode', [zoomTo]
            ));
        }

        if (displayBps && activeEditor?.messageHandler) {
            calls.push(new ProcedureCall(
                sdfgName, activeEditor.messageHandler, 'displayBreakpoints',
                [displayBps]
            ));
        }

        SdfgViewerProvider.getInstance()?.openViewer(
            vscode.Uri.file(filePath), calls
        );
    }

    public async processQueuedInvocations(sdfgName: string): Promise<void> {
        const retainedInvocations = [];
        for (const call of this.queuedProcedureCalls) {
            if (!call.checkExecute(sdfgName))
                retainedInvocations.push(call);
        }
        this.queuedProcedureCalls = retainedInvocations;
    }

    public goToFileLocation(
        fileUri: vscode.Uri,
        startLine: number,
        startCol: number,
        endLine: number,
        endCol: number
    ): void {
        // Load the file and show it in a new editor, highlighting the
        // indicated range.
        vscode.workspace.openTextDocument(fileUri).then(
            (doc: vscode.TextDocument) => {

                const startPos = new vscode.Position(
                    startLine - 1, startCol
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

    public openViewer(
        uri: vscode.Uri, procedureCalls: ProcedureCall[] = []
    ): void {
        // If the SDFG is currently open, then execute the messages
        // otherwise store them to execute as soon as the SDFG is loaded.
        let editorIsLoaded = false;
        for (const editor of this.getOpenEditors()) {
            if (editor.document.uri.fsPath === uri.fsPath) {
                editorIsLoaded = true;
                break;
            }
        }

        if (!editorIsLoaded) {
            // The SDFG isn't yet loaded so we store the messages to execute
            // after the SDFG is loaded (calls `process_queued_messages`).
            for (const call of procedureCalls)
                this.queuedProcedureCalls.push(call);
            vscode.commands.executeCommand(
                'vscode.openWith', uri, SdfgViewerProvider.viewType
            );
        } else {
            // The SDFG is already loaded so we can just jump to it and send the
            // messages.
            vscode.commands.executeCommand(
                'vscode.openWith', uri, SdfgViewerProvider.viewType
            ).then(_ => {
                procedureCalls.forEach(call => {
                    call.execute();
                });
            });
        }

    }

    public async refreshTransformationHistory(
        resetActive: boolean = false
    ): Promise<void> {
        return TransformationHistoryProvider.getInstance()?.refresh(
            resetActive
        );
    }

    public async analysisAddSymbols(symbols: any): Promise<void> {
        return AnalysisProvider.getInstance()?.invokeRemote(
            'addSymbols', [symbols]
        );
    }

    public async analysisSetSymbols(symbols: any): Promise<void> {
        return AnalysisProvider.getInstance()?.invokeRemote(
            'setSymbols', [symbols]
        );
    }

    public async updateAnalysisPanel(
        activeOverlays: any[], symbols: any, scalingMethod?: string,
        scalingSubMethod?: string, availableOverlays?: any[]
    ): Promise<void> {
        return AnalysisProvider.getInstance()?.invokeRemote(
            'refresh', [
                activeOverlays, symbols, scalingMethod, scalingSubMethod,
                availableOverlays
            ]
        );
    }

    public async onDaemonConnected(): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.messageHandler?.
            invoke('setDaemonConnected', [true]);
    }

    public async setMetadata(metadata: any): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.messageHandler?.
            invoke('setMetaDict', [metadata]);
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Add this editor to the list of all editors.
        const editor = new SdfgViewer(webviewPanel.webview, document);
        this.openEditors.push(editor);

        // Make sure that if the webview (editor) gets closed again, we remove
        // it from the open editors list.
        webviewPanel.onDidDispose(() => {
            SdfgViewerProvider.getInstance()?.removeOpenEditor(
                document
            );
            DaCeVSCode.getInstance()?.clearActiveSdfg();
        });

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'media'
                )),
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'node_modules'
                )),
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'dist', 'web'
                )),
            ],
        };
        this.getHtml(webviewPanel.webview).then((html) => {
            webviewPanel.webview.html = html;

            // We want to track the last active SDFG viewer/file.
            if (webviewPanel.active)
                this.updateActiveEditor(editor, document, webviewPanel.webview);
            // Store a ref to the document if it becomes active.
            webviewPanel.onDidChangeViewState(e => {
                if (e.webviewPanel.active)
                    this.updateActiveEditor(
                        editor, document, webviewPanel.webview
                    );
                else
                    DaCeVSCode.getInstance().clearActiveSdfg();
            });

            // Register an event listener for when the document changes on disc.
            // We want to update our webview if that happens.
            const docChangeSubs = vscode.workspace.onDidChangeTextDocument(
                e => {
                    if (e.document.uri.toString() === document.uri.toString() &&
                        e.contentChanges.length > 0)
                        this.documentChanged(editor);
                }
            );
            // Get rid of it when the editor closes.
            webviewPanel.onDidDispose(() => {
                docChangeSubs.dispose();
            });

            // Handle received messages from the webview.
            editor.messageHandler = new ICPCExtensionMessagingComponent(
                webviewPanel.webview, 'sdfv'
            );
            editor.messageHandler.register(this.disableMinimap, this);
            editor.messageHandler.register(this.setSplitDirection, this);
            editor.messageHandler.register(
                this.requestUpdateEditor, this, undefined, [editor]
            );
            editor.messageHandler.register(this.goToSource, this);
            editor.messageHandler.register(this.goToCPP, this);
            editor.messageHandler.register(this.setOutline, this);
            editor.messageHandler.register(this.processQueuedInvocations, this);
            editor.messageHandler.register(this.analysisAddSymbols, this);
            editor.messageHandler.register(this.analysisSetSymbols, this);
            editor.messageHandler.register(this.updateAnalysisPanel, this);
            editor.messageHandler.register(
                this.refreshTransformationHistory, this
            );

            const dace = DaCeInterface.getInstance();
            editor.messageHandler.register(dace.loadTransformations, dace);
            editor.messageHandler.register(dace.expandLibraryNode, dace);
            editor.messageHandler.register(dace.previewTransformation, dace);
            editor.messageHandler.register(dace.applyTransformations, dace);
            editor.messageHandler.register(dace.exportTransformation, dace);
            editor.messageHandler.register(dace.writeToActiveDocument, dace);
            editor.messageHandler.register(dace.getFlops, dace);

            const xfList = TransformationListProvider.getInstance()!;
            editor.messageHandler.register(xfList.clearTransformations, xfList);
            editor.messageHandler.register(xfList.setTransformations, xfList);

            const bpHandler = BreakpointHandler.getInstance()!;
            editor.messageHandler.register(bpHandler.addBreakpoint, bpHandler);
            editor.messageHandler.register(
                bpHandler.removeBreakpoint, bpHandler
            );
            editor.messageHandler.register(bpHandler.getSavedNodes, bpHandler);
            editor.messageHandler.register(bpHandler.hasSavedNodes, bpHandler);

            this.updateEditor(editor);
            webviewPanel.reveal();
        });
    }

    /**
     * Load the HTML to be displayed in the editor's webview.
     *
     * @param webview  Webview to load for
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

        const fpScriptFolder: vscode.Uri = vscode.Uri.file(
            path.join(this.context.extensionPath, 'dist', 'web')
        );
        const scriptsFolder = webview.asWebviewUri(fpScriptFolder);
        baseHtml = baseHtml.replace(
            this.scriptSrcIdentifier, scriptsFolder.toString()
        );

        // If the settings indicate it, split the webview vertically and put
        // the info container to the right instead of at the bottom. Also hide
        // the minimap if the settings say so.
        const sdfvConfig = vscode.workspace.getConfiguration('dace.sdfv');
        if (sdfvConfig?.get<string>('layout') === 'horizontal') {
            baseHtml = baseHtml.replace(
                'offcanvas offcanvas-end',
                'offcanvas offcanvas-bottom'
            );
            baseHtml = baseHtml.replace(
                'expand-info-btn-top',
                'expand-info-btn-bottom'
            );
            baseHtml = baseHtml.replace(
                'id="layout-toggle-btn" class="vertical"',
                'id="layout-toggle-btn" class="horizontal"'
            );
            baseHtml = baseHtml.replace(
                'gutter-vertical',
                'gutter-horizontal'
            );
            baseHtml = baseHtml.replace(
                'SPLIT_DIRECTION = \'vertical\';',
                'SPLIT_DIRECTION = \'horizontal\';'
            );
        }
        if (sdfvConfig?.get<boolean>('minimap') === false)
            baseHtml = baseHtml.replace(
                'MINIMAP_ENABLED = true;',
                'MINIMAP_ENABLED = false;'
            );

        return baseHtml;
    }

}
