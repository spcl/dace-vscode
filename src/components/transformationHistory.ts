import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeVSCode } from '../extension';

import { BaseComponent } from './baseComponent';
import { ComponentMessageHandler } from './messaging/componentMessageHandler';

export class TransformationHistoryProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'transformationHistory';

    private view?: vscode.WebviewView;

    private static INSTANCE: TransformationHistoryProvider | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        TransformationHistoryProvider.INSTANCE = new TransformationHistoryProvider(ctx);
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
            'transformation_history',
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
            case 'refresh':
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

    public refresh() {
        this.clearList(undefined);
        const sdfg = DaCeVSCode.getInstance().getActiveSdfg();
        if (sdfg !== undefined) {
            const history = sdfg.attributes.transformation_hist;
            this.view?.webview.postMessage({
                type: 'set_history',
                history: history,
            });
        }
    }

}