// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from './dace_interface';

import { BaseComponent } from './base_component';
import { ICPCRequest } from '../common/messaging/icpc_messaging_component';

export class AnalysisProvider
    extends BaseComponent
    implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'sdfgAnalysis';

    private view?: vscode.WebviewView;

    private static INSTANCE: AnalysisProvider | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        AnalysisProvider.INSTANCE = new AnalysisProvider(ctx, this.viewType);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: false,
        };
        return vscode.window.registerWebviewViewProvider(
            AnalysisProvider.viewType,
            AnalysisProvider.INSTANCE,
            {
                webviewOptions: options,
            }
        );
    }

    public static getInstance(): AnalysisProvider | undefined {
        return this.INSTANCE;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        // If the DaCe interface has not been started yet, start it here.
        DaCeInterface.getInstance()?.start();

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
            'analysis',
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

            this.setTarget(webviewView.webview);
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

    public async clear(reason?: string): Promise<unknown> {
        return this.invoke('clear', [reason]);
    }

    @ICPCRequest(true)
    public onReady(): void {
        vscode.commands.executeCommand('sdfgAnalysis.sync');
        super.onReady();
    }

    @ICPCRequest(true)
    public async selectReportFile(): Promise<{
        path?: vscode.Uri,
        data?: Record<string, unknown>,
    }> {
        return vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Profile': ['json'],
            },
            openLabel: 'Load',
            title: 'Load instrumentation report',
        }).then(uri => {
            if (uri) {
                return vscode.workspace.fs.readFile(uri[0]).then(val => {
                    return {
                        path: uri[0],
                        data: JSON.parse(
                            Buffer.from(val).toString('utf-8')
                        ) as Record<string, unknown>,
                    };
                });
            }
            return {};
        });
    }

}
