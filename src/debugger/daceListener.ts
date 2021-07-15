// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as Net from 'net';
import * as vscode from 'vscode';
import * as path from 'path';
import { BreakpointHandler } from './breakpointHandler';
import { SdfgViewerProvider } from '../components/sdfgViewer';
import { sdfgEditMode, modeItems, ModeItem } from './daceDebugSession';

export var PORT: number = 0;

export class DaceListener extends vscode.Disposable {

    server: Net.Server;

    // To not spam the user with messages only indicate the restricted features
    // message maximally once per activation 
    hasIndicatedRestricted: boolean;

    lastResult: any;

    constructor() {
        super(() => { this.server.close(); });
        this.server = this.startListening();
        this.hasIndicatedRestricted = false;
        this.lastResult = {};
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
                    canSelectMany: false
                };

                const WFs = vscode.workspace.workspaceFolders;
                if (WFs && WFs.length > 0)
                    dialogOptions.defaultUri = WFs[0].uri;

                const chosenUri = await vscode.window.showOpenDialog(dialogOptions);
                const chosenFile = chosenUri && chosenUri.length > 0 ?
                    chosenUri[0].fsPath : 'none';

                this.lastResult = { 'filename': chosenFile };
                vscode.debug.activeDebugSession?.customRequest('continue');
                return this.lastResult;
            case "sdfgEditMode":
                let selected_mode = sdfgEditMode.RUN;
                const mode:
                    | ModeItem
                    | undefined = await vscode.window.showQuickPick(modeItems, {
                        placeHolder: "Select the next run mode",
                    });
                if (mode)
                    selected_mode = mode.mode;

                this.lastResult = { 'mode': selected_mode };
                vscode.debug.activeDebugSession?.customRequest('continue');
                return this.lastResult;
            case "openSDFG":
                SdfgViewerProvider.getInstance()?.openViewer(vscode.Uri.file(data.filename));
                break;
            case "lastResult":
                return this.lastResult;
            default:
                break;
        }
        return undefined;
    }

}
