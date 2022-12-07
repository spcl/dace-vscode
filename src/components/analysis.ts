// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { ICPCRequest } from '../common/messaging/icpc_messaging_component';
import { DaCeInterface } from '../dace_interface';
import { DaCeVSCode } from '../extension';

import { BaseComponent } from './base_component';

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

    @ICPCRequest()
    public async symbolValueChanged(
        symbol: string, value?: number
    ): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'onSymbolValueChanged', [symbol, value]
        );
    }

    @ICPCRequest()
    public async updateScalingMethod(
        method: string, subMethod?: number
    ): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'onHeatmapScalingChanged', [method, subMethod]
        );
    }

    @ICPCRequest()
    public async setOverlays(overlays: string[]): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'setOverlays', [overlays]
        );
    }

    @ICPCRequest()
    public async onLoadInstrumentationReport(
        report: { traceEvents: any[] }, criterium: string
    ): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'loadInstrumentationReport', [report, criterium]
        );
    }

    @ICPCRequest()
    public async instrumentationReportChangeCriterium(
        criterium: string
    ): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'setInstrumentationReportCriterium', [criterium]
        );
    }

    @ICPCRequest()
    public async clearRuntimeReport(types?: string[]): Promise<void> {
        return DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'clearRuntimeReport', [types]
        );
    }

    @ICPCRequest()
    public specialize(symbols: { [key: string]: any }): void {
        const sdfgFile = DaCeVSCode.getInstance().getActiveSdfgFileName();
        if (sdfgFile) {
            const uri = vscode.Uri.file(sdfgFile);
            DaCeInterface.getInstance().specializeGraph(uri, symbols);
        }
    }

    public show() {
        this.view?.show();
    }

    public isVisible(): boolean {
        if (this.view === undefined)
            return false;
        return this.view.visible;
    }

    public async clear(reason?: string): Promise<void>{
        return this.invoke('clear', [reason]);
    }

    @ICPCRequest()
    public refresh() {
        vscode.commands.executeCommand('sdfgAnalysis.sync');
    }

}
