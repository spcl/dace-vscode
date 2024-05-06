// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from './dace_interface';

import { BaseComponent } from './base_component';
import { ComponentTarget } from './components';
import { ICPCRequest } from '../common/messaging/icpc_messaging_component';
import { DaCeVSCode } from '../dace_vscode';

export class TransformationHistoryProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = ComponentTarget.History;

    private view?: vscode.WebviewView;

    private static INSTANCE?: TransformationHistoryProvider;

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

    @ICPCRequest(true)
    public onReady(): Promise<void> {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor)
            activeEditor.invoke('resyncTransformationHistory');
        else
            this.invoke('clearHistory', ['No SDFG selected']);
        return super.onReady();
    }

}
