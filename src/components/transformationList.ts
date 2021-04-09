// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from '../daceInterface';
import { DaCeVSCode } from '../extension';

import { BaseComponent } from './baseComponent';
import { ComponentMessageHandler } from './messaging/componentMessageHandler';

export class TransformationListProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'transformationList';

    private view?: vscode.WebviewView;

    private static INSTANCE: TransformationListProvider | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        TransformationListProvider.INSTANCE = new TransformationListProvider(
            ctx,
            this.viewType
        );
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: false,
        };
        return vscode.window.registerWebviewViewProvider(
            TransformationListProvider.viewType,
            TransformationListProvider.INSTANCE,
            {
                webviewOptions: options,
            }
        );
    }

    public static getInstance(): TransformationListProvider | undefined {
        return this.INSTANCE;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext<unknown>,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
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
            'transformation_list',
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

    public handleMessage(message: any,
                         origin: vscode.Webview | undefined = undefined): void {
        switch (message.type) {
            default:
                this.view?.webview.postMessage(message);
                break;
        }
    }

    public clearList(reason: string | undefined) {
        this.handleMessage({
            type: 'clear_transformations',
            reason: reason,
        });
    }

    public refresh(hard: boolean = false) {
        this.clearList(undefined);
        if (hard)
            vscode.commands.executeCommand('transformationList.sync');
        else
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                type: 'resync_transformation_list',
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

}