// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from '../dace_interface';
import { DaCeVSCode } from '../extension';

import { BaseComponent } from './base_component';
import { ComponentMessageHandler } from './messaging/component_message_handler';

export class TransformationHistoryProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'transformationHistory';

    private view?: vscode.WebviewView;

    private static INSTANCE: TransformationHistoryProvider | undefined = undefined;

    public activeHistoryItemIndex: Number | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        TransformationHistoryProvider.INSTANCE =
            new TransformationHistoryProvider(ctx, this.viewType);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: false,
        };
        return vscode.window.registerWebviewViewProvider(
            TransformationHistoryProvider.viewType,
            TransformationHistoryProvider.INSTANCE,
            {
                webviewOptions: options,
            }
        );
    }

    public static getInstance(): TransformationHistoryProvider | undefined {
        return this.INSTANCE;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext<unknown>,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        // If the DaCe interface has not been started yet, start it here.
        DaCeInterface.getInstance().start();

        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'dist', 'web'
                )),
            ],
        };

        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath,
            'media',
            'components',
            'history',
            'index.html'
        ));
        const fpScriptFolder: vscode.Uri = vscode.Uri.file(
            path.join(this.context.extensionPath, 'dist', 'web')
        );
        vscode.workspace.fs.readFile(fpBaseHtml).then((data) => {
            let baseHtml = data.toString();
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

    public handleMessage(message: any,
                         origin: vscode.Webview | undefined = undefined): void {
        switch (message.type) {
            case 'refresh':
                if (message.resetActive)
                    this.activeHistoryItemIndex = undefined;
                this.refresh();
                break;
            default:
                this.view?.webview.postMessage(message);
                break;
        }
    }

    public clearList(reason: string | undefined) {
        this.view?.webview.postMessage({
            type: 'clear_history',
            reason: reason,
        });
    }

    public async refresh() {
        this.clearList(undefined);
        const sdfg = await DaCeVSCode.getInstance().getActiveSdfg();
        if (sdfg !== undefined) {
            const history = sdfg.attributes.transformation_hist;
            this.view?.webview.postMessage({
                type: 'set_history',
                history: history,
                activeIndex: this.activeHistoryItemIndex,
            });
        }
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