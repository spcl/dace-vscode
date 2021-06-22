// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from '../daceInterface';

import { BaseComponent } from './baseComponent';
import { ComponentMessageHandler } from './messaging/componentMessageHandler';
import { BreakpointHandler, Node } from '../debugger/breakpointHandler';

export class BreakpointProvider
    extends BaseComponent
    implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'breakpoints';

    private view?: vscode.WebviewView;

    private static INSTANCE: BreakpointProvider | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        BreakpointProvider.INSTANCE = new BreakpointProvider(ctx, this.viewType);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: false,
        };
        return vscode.window.registerWebviewViewProvider(
            BreakpointProvider.viewType,
            BreakpointProvider.INSTANCE,
            {
                webviewOptions: options,
            }
        );
    }

    public static getInstance(): BreakpointProvider | undefined {
        return this.INSTANCE;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        DaCeInterface.getInstance().start();

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
            'breakpoints',
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
        let node;
        switch (message.type) {
            case 'add_breakpoint':
                node = message.node;
                if (node)
                    BreakpointHandler.getInstance()?.handleNodeAdded(
                        new Node(node.sdfg_id, node.state_id, node.node_id),
                        message.sdfg_name
                    );
                break;
            case 'remove_breakpoint':
                node = message.node;
                if (node)
                    BreakpointHandler.getInstance()?.handleNodeRemoved(
                        new Node(node.sdfg_id, node.state_id, node.node_id),
                        message.sdfg_name
                    );
                break;
            case 'get_saved_nodes':
                BreakpointHandler.getInstance()?.getSavedNodes(message.sdfg_name);
                break;
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
        vscode.commands.executeCommand('breakpoints.sync');
    }

}