// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    CancellationToken,
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
    window,
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
    ): Promise<any> {
        return this.invoke(
            'updateContents', [this.document.documentData, preventRefresh]
        );
    }

    protected _getUpToDateContents(): Uint8Array {
        return this.document.documentData;
    }

    public async handleLocalEdit(sdfg: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const compressed = new Uint8Array(gzipSync(sdfg));
            Promise.all([
                this.onSDFGEdited(compressed),
                this.invoke('updateContents', [compressed, false]),
            ]).then(() => {
                resolve();
            }).catch((reason: unknown) => {
                if (reason instanceof Error)
                    reject(reason);
                else
                    reject(new Error('Failed to handle local edit'));
            });
        });
    }

    protected _onSDFGEdited(): boolean {
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

    private constructor() {
        return;
    }

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
                    if (editor && editor instanceof CompressedSDFGEditor) {
                        return (await editor.invoke(
                            'getCompressedSDFG'
                        ) as Uint8Array | null) ?? new Uint8Array();
                    }
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

        disposables.push(document.onDidChangeContent(async () => {
            const editor = DaCeVSCode.getInstance().sdfgEditorMap.get(
                document.uri
            );
            await editor?.updateContents();
        }));

        document.onDidDispose(() => {
            disposables.forEach((d) => void d.dispose());
        });

        return document;
    }

    public resolveCustomEditor(
        document: CompressedSDFGDocument, webviewPanel: WebviewPanel,
        token: CancellationToken
    ): void {
        // Create editor and add it to the open editors.
        if (!this.context)
            throw new Error('CompressedSDFGEditorProvider not initialized');
        new CompressedSDFGEditor(this.context, token, webviewPanel, document);
    }

}

