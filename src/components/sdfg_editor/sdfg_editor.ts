// Copyright 2020-2023 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    CancellationToken,
    CustomTextEditorProvider,
    Disposable,
    ExtensionContext,
    Range,
    TextDocument,
    WebviewOptions,
    WebviewPanel,
    WebviewPanelOptions,
    WorkspaceEdit,
    window,
    workspace
} from 'vscode';
import { SDFGEditorBase } from './common';


export class SDFGEditor extends SDFGEditorBase {

    declare document: TextDocument;

    public constructor(
        context: ExtensionContext, _token: CancellationToken,
        webviewPanel: WebviewPanel, document: TextDocument
    ) {
        super(context, _token, webviewPanel, document);
    }

    protected async _updateContents(
        preventRefreshes: boolean = false
    ): Promise<void> {
        return this.invoke(
            'updateContents', [this.document.getText(), preventRefreshes]
        );
    }

    protected async _getUpToDateContents(): Promise<string> {
        return this.document.getText();
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

    protected async _onSDFGEdited(sdfg: string): Promise<boolean> {
        const edit = new WorkspaceEdit();
        if (typeof sdfg === 'string')
            edit.replace(
                this.document.uri,
                new Range(0, 0, this.document.lineCount, 0), sdfg
            );
        else
            edit.replace(
                this.document.uri,
                new Range(0, 0, this.document.lineCount, 0),
                JSON.stringify(sdfg, null, 2)
            );
        return workspace.applyEdit(edit);
    }

}

export class SDFGEditorProvider implements CustomTextEditorProvider {

    private static INSTANCE: SDFGEditorProvider = new SDFGEditorProvider();

    public static getInstance(): SDFGEditorProvider {
        return SDFGEditorProvider.INSTANCE;
    }

    private constructor() {}

    public static readonly viewType = 'sdfgCustom.sdfv';

    private context?: ExtensionContext;

    public register(context: ExtensionContext): Disposable {
        this.context = context;
        const options: WebviewPanelOptions & WebviewOptions = {
            retainContextWhenHidden: true,
            enableScripts: true,
        };
        return window.registerCustomEditorProvider(
            SDFGEditorProvider.viewType, this, {
                webviewOptions: options,
                supportsMultipleEditorsPerDocument: false,
            }
        );
    }

    public async resolveCustomTextEditor(
        document: TextDocument, webviewPanel: WebviewPanel,
        token: CancellationToken
    ): Promise<void> {
        // Create editor and add it to the open editors.
        if (!this.context)
            throw new Error('SDFGEditorProvider not initialized');
        new SDFGEditor(
            this.context, token, webviewPanel, document
        );
    }

}
