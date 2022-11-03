// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from '../dace_interface';
import { DaCeVSCode } from '../extension';

import { SingletonComponent } from './base_component';

export class OutlineProvider
extends SingletonComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'sdfgOutline';

    private view?: vscode.WebviewView;

    private static INSTANCE?: OutlineProvider;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        OutlineProvider.INSTANCE = new OutlineProvider(ctx, this.viewType);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: false,
        };
        return vscode.window.registerWebviewViewProvider(
            OutlineProvider.viewType,
            OutlineProvider.INSTANCE,
            {
                webviewOptions: options,
            }
        );
    }

    public static getInstance(): OutlineProvider | undefined {
        return this.INSTANCE;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        // If the DaCe interface has not been started yet, start it here.
        DaCeInterface.getInstance().start();

        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'media'
                )),
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'dist', 'web'
                )),
            ],
        };

        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath,
            'media',
            'components',
            'outline',
            'index.html'
        ));
        const fpMediaFolder: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath, 'media'
        ));
        const fpScriptFolder: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath, 'dist', 'web'
        ));
        vscode.workspace.fs.readFile(fpBaseHtml).then((data) => {
            let baseHtml = data.toString();
            baseHtml = baseHtml.replace(
                this.csrSrcIdentifier,
                webviewView.webview.asWebviewUri(fpMediaFolder).toString()
            );
            baseHtml = baseHtml.replace(
                this.scriptSrcIdentifier,
                webviewView.webview.asWebviewUri(fpScriptFolder).toString()
            );
            webviewView.webview.html = baseHtml;

            this.initMessaging(webviewView.webview);
            this.messageHandler?.register(this.zoomToNode, this);
            this.messageHandler?.register(this.highlightElement, this);
            this.messageHandler?.register(this.refresh, this);
        });
    }

    public async setOutline(outlineList: any[]): Promise<void> {
        await this.invokeRemote('setOutline', [outlineList]);
    }

    public async clearOutline(reason?: string): Promise<void> {
        await this.invokeRemote('clearOutline', [reason]);
    }

    public async highlightElement(elementUUID: string): Promise<void> {
        return DaCeVSCode.getInstance()
            .getActiveEditor()?.messageHandler?.invoke(
                'highlightUUIDs', [elementUUID]
            );
    }

    public async zoomToNode(elementUUID: string): Promise<void> {
        return DaCeVSCode.getInstance()
            .getActiveEditor()?.messageHandler?.invoke(
                'zoomToUUIDs', [elementUUID]
            );
    }

    public refresh() {
        vscode.commands.executeCommand('sdfgOutline.sync');
    }

    public show() {
        this.view?.show();
    }

    public isVisible(): boolean {
        if (this.view === undefined)
            return false;
        return this.view.visible;
    }

}
