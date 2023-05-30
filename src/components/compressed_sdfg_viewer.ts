import * as vscode from 'vscode';
import * as path from 'path';
import {
    ICPCExtensionMessagingComponent,
} from './messaging/icpc_extension_messaging_component';
import { TransformationListProvider } from './transformation_list';
import {
    BreakpointHandler,
    SDFGDebugNode,
    getCppRange,
} from '../debugger/breakpoint_handler';
import { ICPCRequest } from '../common/messaging/icpc_messaging_component';
import { OutlineProvider } from './outline';
import { fileExists } from '../utils/utils';
import { DaCeInterface } from '../dace_interface';
import { TransformationHistoryProvider } from './transformation_history';
import { AnalysisProvider } from './analysis';

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

interface CompressedSDFGEdit {
}

interface CompressedSDFGDocumentDelegate {
    getFileData(): Promise<Uint8Array>;
}

interface CompressedSDFGDocumentChangedEvent {
    readonly content?: Uint8Array;
    readonly edits: readonly CompressedSDFGEdit[];
}

class CompressedSDFGDocument
implements vscode.CustomDocument {

    private readonly _uri: vscode.Uri;
    private readonly _delegate: CompressedSDFGDocumentDelegate;

    // Fired when the document is disposed of.
    private readonly _onDidDispose = new vscode.EventEmitter<void>();
    public readonly onDidDispose = this._onDidDispose.event;

    // Fired to notify webviews that the document has changed.
    private readonly _onDidChangeDocument =
        new vscode.EventEmitter<CompressedSDFGDocumentChangedEvent>();
    public readonly onDidChangeContent = this._onDidChangeDocument.event;

    // Fired to tell VSCode that an edit has occurred in the document and
    // to update the dirty indicator.
    private readonly _onDidChange = new vscode.EventEmitter<{
        readonly label: string;
        undo(): void;
        redo(): void;
    }>();
    public readonly onDidChange = this._onDidChange.event;

    private readonly _disposable = vscode.Disposable.from(
        this._onDidDispose, this._onDidChangeDocument, this._onDidChange
    );

    private _documentData: Uint8Array;
    private _edits: CompressedSDFGEdit[] = [];
    private _savedEdits: CompressedSDFGEdit[] = [];

    private constructor(
        uri: vscode.Uri, initialContent: Uint8Array,
        delegate: CompressedSDFGDocumentDelegate
    ) {
        this._uri = uri;
        this._documentData = initialContent;
        this._delegate = delegate;
    }

    static async create(
        uri: vscode.Uri, backupId: string | undefined,
        delegate: CompressedSDFGDocumentDelegate
    ): Promise<CompressedSDFGDocument> {
        const dataFile = typeof backupId === 'string' ?
            vscode.Uri.parse(backupId) : uri;
        const fileData = await CompressedSDFGDocument.readFile(dataFile);
        return new CompressedSDFGDocument(uri, fileData, delegate);
    }

    private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (uri.scheme === 'untitled')
            return new Uint8Array();
        return new Uint8Array(await vscode.workspace.fs.readFile(uri));
    }

    public dispose(): void {
        this._onDidDispose.fire();
        this._disposable.dispose();
    }

    public makeEdit(edit: CompressedSDFGEdit): void {
        this._onDidChange.fire({
            label: 'Edit',
            undo: async () => {
                this._edits.pop();
                this._onDidChangeDocument.fire({
                    edits: this._edits,
                });
            },
            redo: async () => {
                this._edits.push(edit);
                this._onDidChangeDocument.fire({
                    edits: this._edits,
                });
            },
        });
    }

    public get uri(): vscode.Uri {
        return this._uri;
    }

    public get documentData(): Uint8Array {
        return this._documentData;
    }

    public async save(cancellation: vscode.CancellationToken): Promise<void> {
        await this.saveAs(this.uri, cancellation);
        this._savedEdits = this._edits.slice();
    }

    public async saveAs(
        targetResource: vscode.Uri, cancellation: vscode.CancellationToken
    ): Promise<void> {
        const fileData = await this._delegate.getFileData();
        if (cancellation.isCancellationRequested)
            return;
        await vscode.workspace.fs.writeFile(targetResource, fileData);
    }

    public async revert(
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        const diskContent = await CompressedSDFGDocument.readFile(this.uri);
        this._documentData = diskContent;
        this._edits = this._savedEdits;
        this._onDidChangeDocument.fire({
            content: diskContent,
            edits: this._edits,
        });
    }

    public async backup(
        destination: vscode.Uri, cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        await this.saveAs(destination, cancellation);
        return {
            id: destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(destination);
                } catch {
                    // noop
                }
            }
        };
    }

}

export class CompressedSDFGEditor extends ICPCExtensionMessagingComponent {

    public constructor(
        public readonly webviewPanel: vscode.WebviewPanel,
        public readonly document: CompressedSDFGDocument,
    ) {
        super('SDFV', webviewPanel.webview);
    }

    public wrapperFile?: string;
    public argv?: string[];
    public linkFile?: string;

    public async updateContents(
        preventRefresh: boolean = false
    ): Promise<void> {
        return this.invoke(
            'updateContents', [this.document.documentData, preventRefresh]
        );
    }

}

export class CompressedSDFGViewerProvider
implements vscode.CustomEditorProvider<CompressedSDFGDocument> {

    public static INSTANCE: CompressedSDFGViewerProvider =
        new CompressedSDFGViewerProvider();

    public static getInstance(): CompressedSDFGViewerProvider {
        return CompressedSDFGViewerProvider.INSTANCE;
    }

    private constructor() {}

    public static readonly viewType = 'compressedSdfgCustom.sdfv';

    protected readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;
    protected readonly scriptSrcIdentifier = /{{ SCRIPT_SRC }}/g;

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<CompressedSDFGDocument>
    >();
    public readonly onDidChangeCustomDocument =
        this._onDidChangeCustomDocument.event;

    protected context?: vscode.ExtensionContext;

    private readonly openEditors = new Map<vscode.Uri, CompressedSDFGEditor>();

    private queuedProcedureCalls: ProcedureCall[] = [];

    public register(
        context: vscode.ExtensionContext
    ): vscode.Disposable {
        this.context = context;
        const options: vscode.WebviewPanelOptions & vscode.WebviewOptions = {
            enableScripts: true,
            retainContextWhenHidden: true,
        };
        return vscode.window.registerCustomEditorProvider(
            CompressedSDFGViewerProvider.viewType, this, {
                webviewOptions: options,
                supportsMultipleEditorsPerDocument: false,
            },
        );
    }

    private documentChanged(editor: CompressedSDFGEditor): void {
        console.log('Document changed');
    }

    public getUpToDateContents(document: CompressedSDFGDocument): Uint8Array {
        return document.documentData;
    }

    saveCustomDocument(
        document: vscode.CustomDocument, cancellation: vscode.CancellationToken
    ): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    saveCustomDocumentAs(
        document: vscode.CustomDocument, destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    revertCustomDocument(
        document: vscode.CustomDocument, cancellation: vscode.CancellationToken
    ): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    backupCustomDocument(
        document: vscode.CustomDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken
    ): Thenable<vscode.CustomDocumentBackup> {
        throw new Error('Method not implemented.');
    }

    public async openCustomDocument(
        uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<CompressedSDFGDocument> {
        const document = await CompressedSDFGDocument.create(
            uri, openContext.backupId, {
                getFileData: async () => {
                    // TODO
                    return new Uint8Array();
                },
            }
        );

        const disposables: vscode.Disposable[] = [];
        disposables.push(document.onDidChange(e => {
            console.log('here');
            this._onDidChangeCustomDocument.fire({
                document,
                ...e,
            });
        }));
        disposables.push(document.onDidChangeContent(e => {
            const panel = this.openEditors.get(document.uri);
            panel?.webviewPanel.webview.postMessage({
                type: 'onDidChangeContent',
                edits: e.edits,
                content: e.content,
            });
        }));

        document.onDidDispose(() => {
            disposables.forEach(listener => listener.dispose());
        });

        return document;
    }

    public async resolveCustomEditor(
        document: CompressedSDFGDocument, webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Construct a new editor and keep track of it in the open editors dict.
        const editor = new CompressedSDFGEditor(webviewPanel, document);
        this.openEditors.set(document.uri, editor);
        editor.webviewPanel.onDidDispose(() => {
            this.openEditors.delete(document.uri);
        });

        const extPath = this.context?.extensionPath ?? '';
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(extPath, 'media')),
                vscode.Uri.file(path.join(extPath, 'node_modules')),
                vscode.Uri.file(path.join(extPath, 'dist', 'web')),
            ],
        };
        this.getHtml(webviewPanel.webview).then((html) => {
            webviewPanel.webview.html = html;

            webviewPanel.onDidChangeViewState(() => {
                // TODO
            });
            document.onDidChange(() => {
                console.log('updated');
            });

            editor.registerRequestHandler(this);
            editor.register(
                this.getUpToDateContents, this, undefined, [document]
            );
            editor.register(
                (uri: vscode.Uri, data: Uint8Array) => {
                    return vscode.workspace.fs.writeFile(uri, data);
                }, undefined, 'writeToCompressedSDFG', [document.uri]
            );

            editor.registerRequestHandler(DaCeInterface.getInstance());

            const xfList = TransformationListProvider.getInstance()!;
            editor.register(xfList.clearTransformations, xfList);
            editor.register(xfList.setTransformations, xfList);

            const bpHandler = BreakpointHandler.getInstance()!;
            editor.register(bpHandler.addBreakpoint, bpHandler);
            editor.register(bpHandler.removeBreakpoint, bpHandler);
            editor.register(bpHandler.getSavedNodes, bpHandler);
            editor.register(bpHandler.hasSavedNodes, bpHandler);

            webviewPanel.reveal();
        });
    }

    @ICPCRequest()
    public async refreshTransformationHistory(
        resetActive: boolean = false
    ): Promise<void> {
        return TransformationHistoryProvider.getInstance()?.refresh(
            resetActive
        );
    }

    @ICPCRequest()
    public async updateAnalysisPanel(
        activeOverlays: any[], symbols: any, scalingMethod?: string,
        scalingSubMethod?: string, availableOverlays?: any[]
    ): Promise<void> {
        return AnalysisProvider.getInstance()?.invoke(
            'refresh', [
                activeOverlays, symbols, scalingMethod, scalingSubMethod,
                availableOverlays
            ]
        );
    }

    @ICPCRequest()
    public setSplitDirection(dir?: 'vertical' | 'horizontal'): void {
        vscode.workspace.getConfiguration('dace.sdfv')?.update('layout', dir);
    }

    @ICPCRequest()
    public async setOutline(outlineList: any[]): Promise<void> {
        await OutlineProvider.getInstance()?.setOutline(outlineList);
    }

    @ICPCRequest()
    public async processQueuedInvocations(sdfgName: string): Promise<void> {
        const retainedInvocations = [];
        for (const call of this.queuedProcedureCalls) {
            if (!call.checkExecute(sdfgName))
                retainedInvocations.push(call);
        }
        this.queuedProcedureCalls = retainedInvocations;
    }

    @ICPCRequest()
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

    @ICPCRequest()
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

    @ICPCRequest()
    public async getSettings(): Promise<Record<string, any>> {
        const settings: Record<string, any> = {};

        const settingKeys = [
            'minimap', 'showAccessNodes', 'showStateNames', 'showMapSchedules',
            'showDataDescriptorSizes', 'adaptiveContentHiding',
            'inclusiveRanges', 'useVerticalStateMachineLayout',
        ];
        const sdfvConfig = vscode.workspace.getConfiguration('dace.sdfv');
        for (const key of settingKeys)
            settings[key] = sdfvConfig?.get(key);

        return settings;
    }

    @ICPCRequest()
    public async updateSettings(
        settings: Record<string, string | boolean | number>
    ): Promise<void> {
        const sdfvConfig = vscode.workspace.getConfiguration('dace.sdfv');
        const ignoredKeys = ['toolbar'];
        for (const key in settings) {
            if (ignoredKeys.includes(key))
                continue;

            if (settings[key] !== sdfvConfig?.get(key))
                sdfvConfig?.update(key, settings[key]);
        }
    }

    private async getHtml(webview: vscode.Webview): Promise<string> {
        // Load the base HTML we want to display in the webview/editor.
        const extPath = this.context?.extensionPath ?? '';
        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            extPath,
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
            path.join(extPath, 'media')
        );
        const mediaFolderUri = webview.asWebviewUri(fpMediaFolder);
        baseHtml = baseHtml.replace(
            this.csrSrcIdentifier, mediaFolderUri.toString()
        );

        const fpScriptFolder: vscode.Uri = vscode.Uri.file(
            path.join(extPath, 'dist', 'web')
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

        baseHtml = baseHtml.replace(
            'COMPRESSED_SDFG = false;',
            'COMPRESSED_SDFG = true;'
        );

        return baseHtml;
    }

}
