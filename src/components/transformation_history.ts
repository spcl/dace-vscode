// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from '../dace_interface';
import { DaCeVSCode } from '../extension';

import { SingletonComponent } from './base_component';

export class TransformationHistoryProvider
extends SingletonComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'transformationHistory';

    private view?: vscode.WebviewView;

    private static INSTANCE?: TransformationHistoryProvider;

    public activeHistoryItemIndex?: number;

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

            this.initMessaging(webviewView.webview);
            this.messageHandler?.register(this.refresh, this);
            this.messageHandler?.register(this.previewHistoryPoint, this);
            this.messageHandler?.register(this.applyHistoryPoint, this);
        });
    }

    public applyHistoryPoint(index: number): void {
        DaCeInterface.getInstance().applyHistoryPoint(index);
    }

    public previewHistoryPoint(index: number): void {
        DaCeInterface.getInstance().previewHistoryPoint(index);
    }

    public async clearList(reason: string | undefined): Promise<void> {
        return this.invokeRemote('clearHistory', [reason]);
    }

    public async setHistory(history: any, activeIndex?: number): Promise<void> {
        return this.invokeRemote('setHistory', [history, activeIndex]);
    }

    public async refresh(resetAcitve: boolean = false): Promise<void> {
        return this.clearList(undefined).then(() => {
            DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                if (resetAcitve)
                    this.activeHistoryItemIndex = undefined;
                if (sdfg)
                    this.setHistory(
                        sdfg.attributes.transformation_hist,
                        this.activeHistoryItemIndex
                    );
            });
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
