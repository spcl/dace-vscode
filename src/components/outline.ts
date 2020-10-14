import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeVSCode } from '../extension';
import { SdfgViewerProvider } from './sdfgViewer';

export class OutlineProvider implements vscode.WebviewViewProvider {

    // Identifiers for code placement into the webview's HTML.
    private readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;

    private static readonly viewType = 'sdfgOutline';

    private view?: vscode.WebviewView;

    private static INSTANCE: OutlineProvider | undefined = undefined;

    constructor(private readonly context: vscode.ExtensionContext) {
    }

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        OutlineProvider.INSTANCE = new OutlineProvider(ctx);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: true,
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
        context: vscode.WebviewViewResolveContext,
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
            'outline',
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
            if (message.type === undefined)
                return;

            if (message.type.startsWith('sdfv.')) {
                message.type = message.type.replace(/^(sdfv\.)/, '');
                SdfgViewerProvider.getInstance()?.handleExternalMessage(
                    message
                );
            } else {
                this.handleMessage(message);
            }
        });
    }

    private handleMessage(message: any) {
        switch (message.type) {
            default:
                break;
        }
    }

    public handleExternalMessage(message: any) {
        switch (message.type) {
            case 'set_outline':
            case 'clear_outline':
                this.view?.webview.postMessage(message);
                break;
            default:
                break;
        }
    }

    public clearOutline() {
        this.view?.webview.postMessage({
            type: 'clear_outline',
        });
    }

    public refresh() {
        SdfgViewerProvider.getInstance()?.handleExternalMessage({
            type: 'refresh_outline',
        });
    }

}