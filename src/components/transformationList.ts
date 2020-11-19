import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { BaseComponent } from './baseComponent';
import { ComponentMessageHandler } from './messaging/componentMessageHandler';

export class TransformationListProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'transformationList';

    private view?: vscode.WebviewView;

    private static INSTANCE: TransformationListProvider | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        TransformationListProvider.INSTANCE = new TransformationListProvider(ctx);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: true,
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
        context: vscode.WebviewViewResolveContext<unknown>,
        token: vscode.CancellationToken
    ): void | Thenable<void> {
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
        let baseHtml = fs.readFileSync(fpBaseHtml.fsPath, 'utf8');
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
    }

    public handleMessage(message: any,
                         origin: vscode.Webview | undefined = undefined): void {
        switch (message.type) {
            case 'show_loading':
            case 'hide_loading':
            case 'clear_transformations':
            case 'set_transformations':
                this.view?.webview.postMessage(message);
                break;
            default:
                break;
        }
    }

    public clearList() {
        this.handleMessage({
            type: 'clear_transformations',
        });
    }

    public refresh() {
        vscode.commands.executeCommand('transformationList.sync');
    }

}