import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BaseComponent } from './baseComponent';
import { ComponentMessageHandler } from './messaging/componentMessageHandler';

export class SymbolResolutionProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    // Identifiers for code placement into the webview's HTML.
    private readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;

    private static readonly viewType = 'symbolResolution';

    private view?: vscode.WebviewView;

    private static INSTANCE: SymbolResolutionProvider | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        SymbolResolutionProvider.INSTANCE = new SymbolResolutionProvider(ctx);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: true,
        };
        return vscode.window.registerWebviewViewProvider(
            SymbolResolutionProvider.viewType,
            SymbolResolutionProvider.INSTANCE,
            {
                webviewOptions: options,
            }
        );
    }

    public static getInstance(): SymbolResolutionProvider | undefined {
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
            'symbol_resolution',
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

    public handleMessage(message: any, origin: vscode.Webview): void {
        switch (message.type) {
            case 'add_symbol':
            case 'add_symbols':
            case 'define_symbol':
            case 'remove_symbol_definition':
            case 'remove_symbol':
            case 'remove_all_symbol_definitions':
            case 'set_symbols':
            case 'clear_symbols':
                this.view?.webview.postMessage(message);
                break;
            default:
                break;
        }
    }

    public clearSymbols() {
        this.view?.webview.postMessage({
            type: 'clear_symbols',
        });
    }

    public refresh() {
        vscode.commands.executeCommand('symbolResolution.refreshEntry');
    }

}