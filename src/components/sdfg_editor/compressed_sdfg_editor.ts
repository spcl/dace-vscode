// Copyright 2020-2023 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    CancellationToken,
    CustomDocument,
    CustomDocumentBackup,
    CustomDocumentBackupContext,
    CustomDocumentEditEvent,
    CustomDocumentOpenContext,
    CustomEditorProvider,
    Disposable,
    EventEmitter,
    ExtensionContext,
    Uri,
    WebviewOptions,
    WebviewPanel,
    WebviewPanelOptions,
    window
} from 'vscode';
import { SDFGEditorBase } from './common';
import { CompressedSDFGDocument } from './sdfg_document';


export class CompressedSDFGEditor extends SDFGEditorBase {

    declare document: CompressedSDFGDocument;

    public constructor(
        context: ExtensionContext, _token: CancellationToken,
        webviewPanel: WebviewPanel, document: CompressedSDFGDocument
    ) {
        super(context, _token, webviewPanel, document);
    }

    protected async _updateContents(
        preventRefresh: boolean = false
    ): Promise<void> {
        return this.invoke(
            'updateContents', [this.document.documentData, preventRefresh]
        );
    }

    protected async _getUpToDateContents(): Promise<Uint8Array> {
        return this.document.documentData;
    }

    public async handleLocalEdit(sdfg: string): Promise<void> {
        return new Promise((resolve, reject) => {
            Promise.all([
                this.onSDFGEdited(sdfg),
                this.invoke('updateContents', [sdfg, false])
            ]).then(() => {
                resolve();
            }).catch((reason) => {
                reject(reason);
            });
        });
    }

    protected async _onSDFGEdited(sdfg: Uint8Array): Promise<boolean> {
        // TODO
        return false;
    }

}


export class CompressedSDFGEditorProvider implements CustomEditorProvider {

    private static INSTANCE: CompressedSDFGEditorProvider =
        new CompressedSDFGEditorProvider();

    public static getInstance(): CompressedSDFGEditorProvider {
        return CompressedSDFGEditorProvider.INSTANCE;
    }

    private constructor() {}

    public static readonly viewType = 'compressedSdfgCustom.sdfv';

    private context?: ExtensionContext;

    public register(context: ExtensionContext): Disposable {
        this.context = context;
        const options: WebviewPanelOptions & WebviewOptions = {
            retainContextWhenHidden: true,
            enableScripts: true,
        };
        return window.registerCustomEditorProvider(
            CompressedSDFGEditorProvider.viewType, this, {
                webviewOptions: options,
                supportsMultipleEditorsPerDocument: false,
            }
        );
    }

    private readonly _onDidChangeCustomDocument =
        new EventEmitter<CustomDocumentEditEvent<CompressedSDFGDocument>>();
    public readonly onDidChangeCustomDocument =
        this._onDidChangeCustomDocument.event;

    saveCustomDocument(document: CustomDocument, cancellation: CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    saveCustomDocumentAs(document: CustomDocument, destination: Uri, cancellation: CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    revertCustomDocument(document: CustomDocument, cancellation: CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }

    backupCustomDocument(document: CustomDocument, context: CustomDocumentBackupContext, cancellation: CancellationToken): Thenable<CustomDocumentBackup> {
        throw new Error('Method not implemented.');
    }

    public async openCustomDocument(
        uri: Uri, openContext: CustomDocumentOpenContext,
        token: CancellationToken
    ): Promise<CompressedSDFGDocument> {
        const document = await CompressedSDFGDocument.create(
            uri, openContext.backupId, {
                getFileData: async () => {
                    // TODO
                    return new Uint8Array();
                },
            }
        );

        const disposables: Disposable[] = [];

        document.onDidDispose(() => {
            disposables.forEach((d) => d.dispose());
        });

        return document;
    }

    public async resolveCustomEditor(
        document: CompressedSDFGDocument, webviewPanel: WebviewPanel,
        token: CancellationToken
    ): Promise<void> {
        // Create editor and add it to the open editors.
        if (!this.context)
            throw new Error('CompressedSDFGEditorProvider not initialized');
        const editor = new CompressedSDFGEditor(
            this.context, token, webviewPanel, document
        );
    }

}

