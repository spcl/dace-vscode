// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from '../dace_interface';

import { BaseComponent } from './base_component';
import { ComponentMessageHandler } from './messaging/component_message_handler';

export class OutlineProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'sdfgOutline';

    private view?: vscode.WebviewView;

    private static INSTANCE: OutlineProvider | undefined = undefined;

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

            webviewView.webview.onDidReceiveMessage(message => {
                ComponentMessageHandler.getInstance().handleMessage(
                    message,
                    webviewView.webview
                );
            });
        });
    }

    public handleMessage(message: any, origin: vscode.Webview): void {
        switch (message.type) {
            default:
                this.view?.webview.postMessage(message);
                break;
        }
    }

    public clearOutline(reason: string | undefined) {
        this.view?.webview.postMessage({
            type: 'clear_outline',
            reason: reason,
        });
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