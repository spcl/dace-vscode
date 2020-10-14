import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SdfgViewerProvider } from './sdfgViewer';

export class SymbolResolutionProvider implements vscode.WebviewViewProvider {

    // Identifiers for code placement into the webview's HTML.
    private readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;

    private static readonly viewType = 'symbolResolution';

    private view?: vscode.WebviewView;

    private static INSTANCE: SymbolResolutionProvider | undefined = undefined;

    constructor(private readonly context: vscode.ExtensionContext) {
    }

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
        SdfgViewerProvider.getInstance()?.handleExternalMessage({
            type: 'refresh_symbol_list'
        });
    }

}