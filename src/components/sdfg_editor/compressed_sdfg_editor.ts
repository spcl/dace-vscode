// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
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
import { gzipSync } from 'zlib';
import { DaCeVSCode } from '../../dace_vscode';


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
            const compressed = gzipSync(sdfg);
            Promise.all([
                this.onSDFGEdited(compressed),
                this.invoke('updateContents', [compressed, false])
            ]).then(() => {
                resolve();
            }).catch((reason) => {
                reject(reason);
            });
        });
    }

    protected async _onSDFGEdited(): Promise<boolean> {
        this.document.makeEdit({});
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

    public async saveCustomDocument(
        document: CompressedSDFGDocument, cancellation: CancellationToken
    ): Promise<void> {
        await document.save(cancellation);
    }

    public async saveCustomDocumentAs(
        document: CompressedSDFGDocument, destination: Uri,
        cancellation: CancellationToken
    ): Promise<void> {
        await document.saveAs(destination, cancellation);
    }

    public async revertCustomDocument(
        document: CompressedSDFGDocument, cancellation: CancellationToken
    ): Promise<void> {
        return document.revert(cancellation);
    }

    public async backupCustomDocument(
        document: CompressedSDFGDocument, context: CustomDocumentBackupContext,
        cancellation: CancellationToken
    ): Promise<CustomDocumentBackup> {
        return document.backup(context.destination, cancellation);
    }

    public async openCustomDocument(
        uri: Uri, openContext: CustomDocumentOpenContext,
        _token: CancellationToken
    ): Promise<CompressedSDFGDocument> {
        const document = await CompressedSDFGDocument.create(
            uri, openContext.backupId, {
                getFileData: async () => {
                    const editor = DaCeVSCode.getInstance().activeSDFGEditor;
                    if (editor && editor instanceof CompressedSDFGEditor)
                        return await editor.invoke('getCompressedSDFG');
                    return new Uint8Array();
                },
            }
        );

        const disposables: Disposable[] = [];

        disposables.push(document.onDidChange(e => {
            // Notify VSCode about a change in the document.
            this._onDidChangeCustomDocument.fire({
                document,
                ...e,
            });
        }));

        disposables.push(document.onDidChangeContent(e => {
            const editor = DaCeVSCode.getInstance().sdfgEditorMap.get(
                document.uri
            );
            editor?.updateContents();
        }));

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

