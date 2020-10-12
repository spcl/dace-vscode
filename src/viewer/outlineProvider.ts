import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DaCeVSCode } from '../extension';

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
                webviewOptions: options
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
                ))
            ]
        };

        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath, 'media', 'outline_base_layout.html'
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

        webviewView.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'zoomToNode':
                    DaCeVSCode.getInstance().activeEditorSendPost({
                        type: 'zoom_to_node',
                        uuid: e.uuid,
                    });
                    break;
            }
        });
    }

    public makePaneVisible() {
        this.view?.show();
    }

    public updateOutline(html: string) {
        this.view?.webview.postMessage({
            type: 'setOutline',
            html: html,
        });
    }

    public clearOutline() {
        this.view?.webview.postMessage({
            type: 'clearOutline',
        });
    }

}