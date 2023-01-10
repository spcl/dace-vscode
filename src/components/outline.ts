// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { ICPCRequest } from '../common/messaging/icpc_messaging_component';
import { DaCeInterface } from '../dace_interface';
import { DaCeVSCode } from '../extension';

import { BaseComponent } from './base_component';

export class OutlineProvider
extends BaseComponent
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

            this.setTarget(webviewView.webview);
        });
    }

    public async setOutline(outlineList: any[]): Promise<void> {
        await this.invoke('setOutline', [outlineList]);
    }

    public async clearOutline(reason?: string): Promise<void> {
        await this.invoke('clearOutline', [reason]);
    }

    @ICPCRequest()
    public async highlightElement(elementUUID: string): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'highlightUUIDs', [elementUUID]
        );
    }

    @ICPCRequest()
    public async zoomToNode(elementUUID: string): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'zoomToUUIDs', [elementUUID]
        );
    }

    @ICPCRequest()
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
