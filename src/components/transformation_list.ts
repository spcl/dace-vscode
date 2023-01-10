// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { ICPCRequest } from '../common/messaging/icpc_messaging_component';
import { DaCeInterface } from '../dace_interface';
import { DaCeVSCode } from '../extension';
import {
    JsonTransformation,
    JsonTransformationList
} from '../webclients/components/transformations/transformations';

import { BaseComponent } from './base_component';

export class TransformationListProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'transformationList';

    private view?: vscode.WebviewView;

    private static INSTANCE?: TransformationListProvider;

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
            'transformations',
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

    @ICPCRequest()
    public async selectTransformation(
        transformation: JsonTransformation
    ): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'selectTransformation', [transformation]
        );
    }

    @ICPCRequest()
    public async highlightElements(uuids: string[]): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'highlightUUIDs', [uuids]
        );
    }

    @ICPCRequest()
    public async applyTransformations(
        transformations: JsonTransformation[]
    ): Promise<void> {
        return DaCeInterface.getInstance().applyTransformations(
            transformations
        );
    }

    public async setTransformations(
        transformations: JsonTransformationList, hideLoading: boolean = true
    ): Promise<void> {
        return this.invoke('setTransformations', [
            transformations, hideLoading
        ]);
    }

    public async showLoading(): Promise<void> {
        return this.invoke('showLoading');
    }

    public async hideLoading(): Promise<void> {
        return this.invoke('hideLoading');
    }

    public async deselect(): Promise<void> {
        return this.invoke('deselect');
    }

    public async clearTransformations(
        reason: string | undefined
    ): Promise<void> {
        return this.invoke('clearTransformations', [reason]);
    }

    @ICPCRequest()
    public refresh(hard: boolean = false) {
        this.clearTransformations(undefined);
        if (hard)
            vscode.commands.executeCommand('transformationList.sync');
        else
            DaCeVSCode.getInstance().getActiveEditor()?.invoke(
                'resyncTransformations'
            );
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
