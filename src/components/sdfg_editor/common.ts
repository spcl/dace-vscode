// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
    CancellationToken,
    Disposable,
    ExtensionContext,
    TextDocument,
    Uri,
    Webview,
    WebviewPanel,
    commands,
    window,
    workspace,
} from 'vscode';
import { ICPCRequest } from '../../common/messaging/icpc_messaging_component';
import { DaCeVSCode } from '../../dace_vscode';
import * as utils from '../../utils/utils';
import { BaseComponent } from '../base_component';
import { CompressedSDFGDocument } from './sdfg_document';


export abstract class SDFGEditorBase extends BaseComponent {

    public wrapperFile?: string;
    public argv?: string[];
    public linkFile?: string;

    public readonly componentId: string;

    private readonly statusBarMessages = new Map<string, Disposable>();

    public constructor(
        context: ExtensionContext, _token: CancellationToken,
        public readonly webviewPanel: WebviewPanel,
        public readonly document: TextDocument | CompressedSDFGDocument
    ) {
        const _componentId = 'SDFV_' + uuidv4();
        super(context, _componentId, webviewPanel.webview);
        this.componentId = _componentId;

        DaCeVSCode.getInstance().sdfgEditorMap.set(document.uri, this);
        this.webviewPanel.onDidDispose(() => {
            DaCeVSCode.getInstance().sdfgEditorMap.delete(document.uri);
            DaCeVSCode.getInstance().activeSDFGEditor = undefined;
            super.dispose();
        });

        this.webviewPanel.onDidChangeViewState(() => {
            this.toggleActiveEditor();
        });

        const extPath = this.context.extensionPath;
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                Uri.file(path.join(extPath, 'media')),
                Uri.file(path.join(extPath, 'node_modules')),
                Uri.file(path.join(extPath, 'dist', 'web')),
            ],
        };

        void this.generateHTML(this.webviewPanel.webview).then((html) => {
            this.webviewPanel.webview.html = html;
            this.toggleActiveEditor();
        });
    }

    private toggleActiveEditor(): void {
        if (this.webviewPanel.active)
            DaCeVSCode.getInstance().activeSDFGEditor = this;
        else if (DaCeVSCode.getInstance().activeSDFGEditor === this)
            DaCeVSCode.getInstance().activeSDFGEditor = undefined;
    }

    private async generateHTML(webview: Webview): Promise<string> {
        // Load the base HTML we want to display in the webview/editor.
        const extPath = this.context.extensionPath;
        const fpBaseHtml: Uri = Uri.file(path.join(
            extPath,
            'media',
            'components',
            'sdfv',
            'index.html'
        ));
        let baseHtml = (await workspace.fs.readFile(fpBaseHtml)).toString();

        // Set the media base-path in the HTML, to load scripts and styles.
        const fpMediaFolder: Uri = Uri.file(path.join(extPath, 'media'));
        const mediaFolderUri = webview.asWebviewUri(fpMediaFolder);
        baseHtml = baseHtml.replace(
            this.csrSrcIdentifier, mediaFolderUri.toString()
        );

        const fpScriptFolder: Uri = Uri.file(path.join(extPath, 'dist', 'web'));
        const scriptsFolder = webview.asWebviewUri(fpScriptFolder);
        baseHtml = baseHtml.replace(
            this.scriptSrcIdentifier, scriptsFolder.toString()
        );

        // If the settings indicate it, split the webview vertically and put
        // the info container to the right instead of at the bottom. Also hide
        // the minimap if the settings say so.
        const sdfvConfig = workspace.getConfiguration('dace.sdfv');
        if (sdfvConfig.get<string>('layout') === 'horizontal') {
            baseHtml = baseHtml.replace(
                'offcanvas offcanvas-end',
                'offcanvas offcanvas-bottom'
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

        return baseHtml;
    }

    public abstract handleLocalEdit(sdfg: string): Promise<void> | void;

    protected abstract _updateContents(preventRefresh?: boolean): any;

    @ICPCRequest()
    public async updateContents(preventRefresh?: boolean): Promise<void> {
        await this._updateContents(preventRefresh);
    }

    protected abstract _getUpToDateContents(
    ): Promise<string | Uint8Array> | string | Uint8Array;

    @ICPCRequest()
    public async getUpToDateContents(): Promise<string | Uint8Array> {
        return this._getUpToDateContents();
    }

    protected abstract _onSDFGEdited(
        sdfg: string | Uint8Array
    ): Promise<boolean> | boolean;

    @ICPCRequest()
    public async onSDFGEdited(sdfg: string | Uint8Array): Promise<boolean> {
        return this._onSDFGEdited(sdfg);
    }

    @ICPCRequest()
    public getSettings(settingKeys: string[]): Record<string, any> {
        const settings: Record<string, any> = {};
        const sdfvConfig = workspace.getConfiguration('dace.sdfv');
        for (const key of settingKeys)
            settings[key] = sdfvConfig.get<unknown>(key);

        return settings;
    }

    @ICPCRequest()
    public updateSettings(
        settings: Record<string, string | boolean | number>
    ): void {
        const sdfvConfig = workspace.getConfiguration('dace.sdfv');
        const ignoredKeys = ['toolbar'];
        for (const key in settings) {
            if (ignoredKeys.includes(key))
                continue;

            if (settings[key] !== sdfvConfig.get(key))
                sdfvConfig.update(key, settings[key]);
        }
    }

    @ICPCRequest()
    public setSplitDirection(dir?: 'vertical' | 'horizontal'): void {
        workspace.getConfiguration('dace.sdfv').update('layout', dir);
    }

    @ICPCRequest()
    public async goToSource(
        pFilePath: string, startRow: number, startChar: number, endRow: number,
        endChar: number
    ): Promise<void> {
        return utils.goToSource(
            pFilePath, startRow, startChar, endRow, endChar
        );
    }

    @ICPCRequest()
    public async goToCPP(
        sdfgName: string, sdfgId: number, stateId: number, nodeId: number,
        cachePath?: string
    ): Promise<void> {
        return utils.goToGeneratedCode(
            sdfgName, sdfgId, stateId, nodeId, cachePath
        );
    }

    public static async openEditorFor(
        uri: Uri
    ): Promise<SDFGEditorBase | undefined> {
        let editor = DaCeVSCode.getInstance().sdfgEditorMap.get(uri);
        editor ??= await commands.executeCommand('vscode.open', uri);
        return editor;
    }

    public static async goToSDFG(
        sdfgPath: string | Uri, zoomTo: string[],
        displayBreakpoints: boolean = false
    ): Promise<void> {
        const uri = typeof sdfgPath === 'string' ?
            Uri.file(sdfgPath) : sdfgPath;
        const editor = await SDFGEditorBase.openEditorFor(uri);
        await editor?.invoke('zoomToUUIDs', [zoomTo]);
        if (displayBreakpoints)
            await editor?.invoke('displayBreakpoints', [displayBreakpoints]);
    }

    @ICPCRequest()
    public showActivity(text: string): string {
        const cancellation = window.setStatusBarMessage(text);
        let uuid = uuidv4();
        while (this.statusBarMessages.has(uuid))
            uuid = uuidv4();
        this.statusBarMessages.set(uuid, cancellation);
        return uuid;
    }

    @ICPCRequest()
    public hideActivity(uuid: string): void {
        const cancellation = this.statusBarMessages.get(uuid);
        if (cancellation) {
            cancellation.dispose();
            this.statusBarMessages.delete(uuid);
        }
    }

}
