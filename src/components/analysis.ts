// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeInterface } from '../dace_interface';
import { DaCeVSCode } from '../extension';

import { SingletonComponent } from './base_component';

export class AnalysisProvider
extends SingletonComponent
implements vscode.WebviewViewProvider {

    public static readonly COMPONENT_NAME = 'sdfgAnalysis';

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

            this.initMessaging(
                AnalysisProvider.COMPONENT_NAME, webviewView.webview
            );
            this.messageHandler?.register(this.refresh, this);
            this.messageHandler?.register(
                this.instrumentationReportChangeCriterium, this
            );
            this.messageHandler?.register(this.specialize, this);
            this.messageHandler?.register(this.setOverlays, this);
            this.messageHandler?.register(
                this.onLoadInstrumentationReport, this
            );
            this.messageHandler?.register(this.updateScalingMethod, this);
            this.messageHandler?.register(this.symbolValueChanged, this);
        });
    }

    public symbolValueChanged(symbol: string, value: any): void {
        // TODO: Implement, call SDFV
    }

    public updateScalingMethod(method: string, subMethod: string): void {
        // TODO: Implement, call SDFV
    }

    public setOverlays(overlays: any[]): void {
        // TODO: Implement, call SDFV
    }

    public onLoadInstrumentationReport(report: any, criterium: string) {
        // TODO: Implement, call SDFV
    }

    public instrumentationReportChangeCriterium(criterium: string): void {
        // TODO: Implement, call SDFV
    }

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
        return this.invokeRemote('clear', [reason]);
    }

    public refresh() {
        vscode.commands.executeCommand('sdfgAnalysis.sync');
    }

}
