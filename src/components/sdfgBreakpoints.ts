// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { BreakpointHandler } from '../debugger/breakpointHandler';

import { BaseComponent } from './baseComponent';
import { ComponentMessageHandler } from './messaging/componentMessageHandler';

export class SdfgBreakpointProvider
    extends BaseComponent
    implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'sdfgBreakpoints';

    private view?: vscode.WebviewView;

    private static INSTANCE: SdfgBreakpointProvider | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        SdfgBreakpointProvider.INSTANCE = new SdfgBreakpointProvider(ctx, this.viewType);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: false,
        };
        return vscode.window.registerWebviewViewProvider(
            SdfgBreakpointProvider.viewType,
            SdfgBreakpointProvider.INSTANCE,
            {
                webviewOptions: options,
            }
        );
    }

    public static getInstance(): SdfgBreakpointProvider | undefined {
        return this.INSTANCE;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'media'
                )),
            ],
        };

        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath,
            'media',
            'components',
            'sdfgBreakpoints',
            'index.html'
        ));
        const fpMediaFolder: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath, 'media'
        ));
        vscode.workspace.fs.readFile(fpBaseHtml).then((data) => {
            let baseHtml = data.toString();
            baseHtml = baseHtml.replace(
                this.csrSrcIdentifier,
                webviewView.webview.asWebviewUri(fpMediaFolder).toString()
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

    public show() {
        this.view?.show();
    }

    public isVisible(): boolean {
        if (this.view === undefined)
            return false;
        return this.view.visible;
    }

    public handleMessage(message: any, origin?: vscode.Webview): void {
        switch (message.type) {
            case 'refresh_sdfg_breakpoints':
                message.nodes = BreakpointHandler.getInstance()?.getAllNodes();
            // Fallthrough to send to the webview
            default:
                this.view?.webview.postMessage(message);
                break;
        }
    }

    public clear(reason: string | undefined) {
        this.view?.webview.postMessage({
            type: 'clear',
            reason: reason,
        });
    }

    public refresh() {
        vscode.commands.executeCommand('sdfgBreakpoints.sync');
    }

}