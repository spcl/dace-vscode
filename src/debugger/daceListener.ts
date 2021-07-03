// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as Net from 'net';
import * as vscode from 'vscode';
import { BreakpointHandler } from './breakpointHandler';
import { SdfgViewerProvider } from '../components/sdfgViewer';

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
                this.handleData(JSON.parse(dataStr));
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

    protected handleData(data: any | undefined) {
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
            case "stopForTransformation":
                const activeSession = vscode.debug.activeDebugSession;
                if (activeSession)
                    SdfgViewerProvider.getInstance()?.openViewer(vscode.Uri.file(data.filename));

            default:
                break;
        }
    }

}
