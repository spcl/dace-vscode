// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { ICPCRequest } from '../common/messaging/icpc_messaging_component';
import {
    BreakpointHandler,
    ISDFGDebugNodeInfo
} from '../debugger/breakpoint_handler';
import { BaseComponent } from './base_component';
import { SdfgViewerProvider } from './sdfg_viewer';

export class SdfgBreakpointProvider
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = 'sdfgBreakpoints';

    private view?: vscode.WebviewView;

    private static INSTANCE: SdfgBreakpointProvider | undefined = undefined;

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        SdfgBreakpointProvider.INSTANCE = new SdfgBreakpointProvider(
            ctx, this.viewType
        );
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: false,
        };
        return vscode.window.registerWebviewViewProvider(
            SdfgBreakpointProvider.viewType,
            SdfgBreakpointProvider.INSTANCE,
            {
                webviewOptions: options,
            }
        );
    }

    public static getInstance(): SdfgBreakpointProvider | undefined {
        return this.INSTANCE;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
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
            'breakpoints',
            'index.html'
        ));
        const fpScriptSrcFolder: vscode.Uri = vscode.Uri.file(
            path.join(this.context.extensionPath, 'dist', 'web')
        );
        vscode.workspace.fs.readFile(fpBaseHtml).then((data) => {
            let baseHtml = data.toString();
            baseHtml = baseHtml.replace(
                this.scriptSrcIdentifier,
                webviewView.webview.asWebviewUri(fpScriptSrcFolder).toString()
            );
            webviewView.webview.html = baseHtml;

            this.setTarget(webviewView.webview);
        });
    }

    @ICPCRequest()
    public goToSDFG(node: ISDFGDebugNodeInfo) {
        if (node.sdfgName && node.sdfgPath)
            SdfgViewerProvider.getInstance()?.goToSDFG(
                `${node.sdfgId}/${node.stateId}/-1/-1`, node.sdfgName,
                node.sdfgPath, true
            );
    }

    @ICPCRequest()
    public goToCPP(node: ISDFGDebugNodeInfo) {
        if (node.sdfgName && node.sdfgPath)
            SdfgViewerProvider.getInstance()?.goToCPP(
                node.sdfgName, node.sdfgId, node.stateId, node.nodeId,
                node.cache
            );
    }

    @ICPCRequest()
    public removeBreakpoint(node: ISDFGDebugNodeInfo): void {
        // TODO: Inform the BPHandler and SDFV
    }

    public async addBreakpoint(
        node: ISDFGDebugNodeInfo, unbounded: boolean = false
    ): Promise<void> {
        return this.invoke('addSDFGBreakpoint', [node, unbounded]);
    }

    public show() {
        this.view?.show();
    }

    public isVisible(): boolean {
        if (this.view === undefined)
            return false;
        return this.view.visible;
    }

    public async clear(): Promise<void> {
        return this.invoke('refresh', [undefined]);
    }

    public async refresh(): Promise<void> {
        const nodes = BreakpointHandler.getInstance()?.getAllNodes();
        return this.invoke('onRefresh', [nodes]);
    }

}
