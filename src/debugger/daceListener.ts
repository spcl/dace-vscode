// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as Net from 'net';
import * as vscode from 'vscode';
import { BreakpointHandler } from './breakpointHandler';
import { SdfgViewerProvider } from '../components/sdfgViewer';
import { sdfgEditMode, modeItems, ModeItem } from './daceDebugSession';

export var PORT: number = 0;

export class DaceListener extends vscode.Disposable {

    server: Net.Server;

    // To not spam the user with messages only indicate the restricted features
    // message maximally once per activation 
    hasIndicatedRestricted: boolean;

    constructor() {
        super(() => { this.server.close(); });
        this.server = this.startListening();
        this.hasIndicatedRestricted = false;
    }

    public startListening() {
        // Create a server to receive information from DaCe
        const server = Net.createServer((socket) => {
            socket.on('end', () => { });

            socket.on('data', data => {
                let dataStr = String.fromCharCode(...data);
                this.handleData(JSON.parse(dataStr)).then(reply => {
                    if (reply) {
                        socket.write(Buffer.from(JSON.stringify(reply)));
                    }
                });
            });
        });

        // listen on a random port and save the port number
        // to the exported variable PORT
        server.listen(0, () => {
            if (!server.address() || typeof server.address() === "string") {
                console.log(server.address());
                let msg = "Error occurred while starting server";
                vscode.window.showErrorMessage(msg);
            }

            let addr = server.address() as Net.AddressInfo;
            PORT = addr.port;
        });

        return server;
    }

    protected async handleData(data: any | undefined) {
        if (!data) {
            return;
        }
        switch (data.type) {
            case "registerFunction":
                BreakpointHandler.getInstance()?.registerFunction(data);
                break;
            case "restrictedFeatures":
                if (!this.hasIndicatedRestricted) {
                    if (data.reason === 'config.cache.hash') {
                        // When using the cache config 'hash' the mapping won't
                        // be created and so not all features can be used
                        const msg = "Due to the use of the cache configuration " +
                            "'hash' only restricted debug features can be supported";
                        vscode.window.showInformationMessage(msg);
                        this.hasIndicatedRestricted = true;
                    }
                }
                break;
            case "loadSDFG":
                let dialogOptions: vscode.OpenDialogOptions = {
                    filters: { 'SDFG': ['sdfg'] },
                    openLabel: 'load SDFG',
                    title: 'load SDFG',
                    canSelectMany: false
                };

                const WFs = vscode.workspace.workspaceFolders;
                if (WFs && WFs.length > 0)
                    dialogOptions.defaultUri = WFs[0].uri;

                const chosenUri = await vscode.window.showOpenDialog(dialogOptions);
                return (chosenUri && chosenUri.length > 0) ?
                    { 'filename': chosenUri[0].fsPath } : {};
            case "saveSDFG":
                let saveOptions: vscode.SaveDialogOptions = {
                    filters: { 'SDFG': ['sdfg'] },
                    saveLabel: 'save SDFG',
                    title: 'save SDFG'
                };

                const WFolders = vscode.workspace.workspaceFolders;
                if (WFolders && WFolders.length > 0)
                    saveOptions.defaultUri = WFolders[0].uri;

                const uri = await vscode.window.showSaveDialog(saveOptions);
                return uri ? { 'filename': uri.fsPath } : {};
            case "sdfgEditMode":
                let selected_mode = sdfgEditMode.RUN;
                const mode:
                    | ModeItem
                    | undefined = await vscode.window.showQuickPick(modeItems, {
                        placeHolder: "Select the next run mode",
                    });
                if (mode)
                    selected_mode = mode.mode;

                return { 'mode': selected_mode };
            case "stopAndTransform":
                SdfgViewerProvider.getInstance()?.openViewer(vscode.Uri.file(data.filename));

                const opt = await vscode.window.showInformationMessage(
                    'Click continue when you want to proceed with the transformation',
                    'continue'
                );
                switch (opt) {
                    case 'continue':
                        return {};
                }
                break;
            case "openSDFG":
                SdfgViewerProvider.getInstance()?.openViewer(vscode.Uri.file(data.filename));
                break;
            default:
                break;
        }
        return undefined;
    }

}
