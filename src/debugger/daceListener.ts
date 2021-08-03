// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as Net from 'net';
import * as vscode from 'vscode';
import { BreakpointHandler } from './breakpointHandler';
import { SdfgViewerProvider, Message } from '../components/sdfgViewer';
import { sdfgEditMode, modeItems, ModeItem } from './daceDebugSession';

export var PORT: number = 0;

export class DaceListener extends vscode.Disposable {

    private static INSTANCE: DaceListener | undefined = undefined;

    server: Net.Server;

    sockets: Map<Number, Net.Socket>;

    // To not spam the user with messages only indicate the restricted features
    // message maximally once per activation 
    hasIndicatedRestricted: boolean;

    constructor() {
        super(() => { this.server.close(); });
        this.server = this.startListening();
        this.hasIndicatedRestricted = false;
        this.sockets = new Map<number, Net.Socket>();
    }

    public static getInstance(): DaceListener | undefined {
        return this.INSTANCE;
    }

    public static activate() {
        DaceListener.INSTANCE = new DaceListener();
        return DaceListener.INSTANCE;
    }

    public startListening() {
        // Create a server to receive information from DaCe
        const server = Net.createServer((socket) => {
            socket.on('end', () => { });

            socket.on('data', data => {
                let dataStr = String.fromCharCode(...data);
                this.handleData(JSON.parse(dataStr), socket);
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

    protected async handleData(data: any | undefined, socket: Net.Socket) {
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
                this.send(
                    socket,
                    (chosenUri && chosenUri.length > 0) ?
                        { 'filename': chosenUri[0].fsPath } : {}
                );
                break;
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
                this.send(socket, uri ? { 'filename': uri.fsPath } : {});
                break;
            case "sdfgEditMode":
                let selected_mode = sdfgEditMode.RUN;
                const mode:
                    | ModeItem
                    | undefined = await vscode.window.showQuickPick(modeItems, {
                        placeHolder: "Select the next run mode",
                    });
                if (mode)
                    selected_mode = mode.mode;

                this.send(socket, { 'mode': selected_mode });
                break;
            case "stopAndTransform":
                const socketNumber = new Date().valueOf();
                this.sockets.set(socketNumber, socket);
                const msgs: Message[] = [
                    new Message(data.sdfgName, {
                        type: 'sdfg_edit_show_continue',
                        socketNumber: socketNumber
                    })
                ];
                SdfgViewerProvider.getInstance()?.openViewer(
                    vscode.Uri.file(data.filename),
                    msgs
                );
                break;
            case "pick_report":
                let reportOptions: vscode.OpenDialogOptions = {
                    canSelectFiles: false,
                    canSelectFolders: true,
                    title: 'select Report',
                    openLabel: 'select Report',
                    canSelectMany: false
                };

                const folders = vscode.workspace.workspaceFolders;
                if (folders && folders.length > 0)
                    reportOptions.defaultUri = folders[0].uri;

                const Uri1 = await vscode.window.showOpenDialog(reportOptions);
                const Uri2 = await vscode.window.showOpenDialog(reportOptions);
                this.send(
                    socket,
                    (Uri1 && Uri1.length > 0 && Uri2 && Uri2.length > 0) ?
                        {
                            'foldername1': Uri1[0].fsPath,
                            'foldername2': Uri2[0].fsPath
                        } : {}
                );
                break;
            case 'correctness_report':
                const reports = data['reports'];
                if (!reports) return;
                const sockNumber = new Date().valueOf();
                this.sockets.set(sockNumber, socket);
                const messagess: Message[] = [
                    new Message(data.sdfgName, {
                        type: 'sdfg_edit_show_continue',
                        socketNumber: sockNumber
                    }),
                    new Message(data.sdfgName, {
                        type: 'correctness_report',
                        reports: reports
                    })
                ];
                SdfgViewerProvider.getInstance()?.openViewer(
                    vscode.Uri.file(data.filename),
                    messagess
                );
                break;
            case "openSDFG":
                SdfgViewerProvider.getInstance()?.openViewer(
                    vscode.Uri.file(data.filename)
                );
                break;
            default:
                break;
        }
    }

    public handleMessage(message: any, origin: vscode.Webview) {
        switch (message.type) {
            case 'sdfg_edit_continue':
                const socket = this.sockets.get(message.socketNumber);
                if (socket)
                    this.send(socket, {});
                break;
            default:
                break;
        }
    }

    public send(socket: Net.Socket, response: any) {
        socket.write(Buffer.from(JSON.stringify(response)));
    }

}
