// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as net from 'net';
import * as vscode from 'vscode';
import { SdfgViewerProvider, SDFVMessage } from '../components/sdfg_viewer';
import { DaCeVSCode } from '../extension';
import { BreakpointHandler } from './breakpoint_handler';
import { CorrectnessReport, CorrectnessReportHandler } from './correctness_report_handler';
import { DaceDebuggingSession, SDFGEditMode, SDFGEditModeItem } from './dace_debugging_session';

export class DaceListener extends vscode.Disposable {

    private static readonly INSTANCE = new DaceListener();

    private server: net.Server | null = null;
    private sockets: Map<number, net.Socket> = new Map<number, net.Socket>();
    private port: number = 0;

    // To not spam the user with messages only indicate the restricted features
    // message maximally once per activation 
    private hasIndicatedRestricted: boolean = false;

    private constructor() {
        super(() => {
            this.server?.close();
        });
        this.startListening();
    }

    public static getInstance(): DaceListener {
        return this.INSTANCE;
    }

    public async startListening(): Promise<void> {
        // Create a server to receive information from DaCe
        const server = net.createServer((socket) => {
            socket.on('end', () => {
            });

            socket.on('data', data => {
                const dataStr = String.fromCharCode(...data);
                this.handleData(JSON.parse(dataStr), socket);
            });
        });

        // listen on a random port and save the port number.
        server.listen(0, () => {
            if (!server.address() || typeof server.address() === 'string') {
                const msg = 'Error occurred while starting server';
                vscode.window.showErrorMessage(msg);
            }

            const addr = server.address() as net.AddressInfo;
            this.port = addr.port;
        });

        this.server = server;
    }

    protected async handleData(
        data: any | undefined, socket: net.Socket
    ): Promise<void> {
        if (!data)
            return;

        switch (data.type) {
            case 'registerFunction':
                BreakpointHandler.getInstance()?.registerFunction(data);
                break;
            case 'restrictedFeatures':
                if (!this.hasIndicatedRestricted) {
                    if (data.reason === 'config.cache.hash') {
                        // When using the cache config 'hash' the mapping won't
                        // be created and so not all features can be used
                        const msg = 'Due to the use of the cache ' +
                            'configuration "hash" only restricted debug ' +
                            'features can be supported';
                        vscode.window.showInformationMessage(msg);
                        this.hasIndicatedRestricted = true;
                    }
                }
                break;
            case 'loadSDFG':
                {
                    const dialogOptions: vscode.OpenDialogOptions = {
                        filters: {
                            'SDFG': ['sdfg'],
                        },
                        openLabel: 'load SDFG',
                        title: 'load SDFG',
                        canSelectMany: false
                    };

                    const wspaceFolders = vscode.workspace.workspaceFolders;
                    if (wspaceFolders && wspaceFolders.length > 0)
                        dialogOptions.defaultUri = wspaceFolders[0].uri;

                    const chosenUri =
                        await vscode.window.showOpenDialog(dialogOptions);
                    this.send(
                        socket,
                        (chosenUri && chosenUri.length > 0) ? {
                            'filename': chosenUri[0].fsPath,
                        } : {}
                    );
                }
                break;
            case 'saveSDFG':
                {
                    const saveOptions: vscode.SaveDialogOptions = {
                        filters: {
                            'SDFG': ['sdfg'],
                        },
                        saveLabel: 'save SDFG',
                        title: 'save SDFG'
                    };

                    const wspaceFolders = vscode.workspace.workspaceFolders;
                    if (wspaceFolders && wspaceFolders.length > 0)
                        saveOptions.defaultUri = wspaceFolders[0].uri;

                    const uri = await vscode.window.showSaveDialog(saveOptions);
                    this.send(socket, uri ? { 'filename': uri.fsPath } : {});
                }
                break;
            case 'stopAndTransform':
                {
                    const socketNumber = new Date().valueOf();
                    this.sockets.set(socketNumber, socket);
                    const msgs: SDFVMessage[] = [
                        new SDFVMessage(data.sdfgName, {
                            type: 'sdfg_edit_show_continue',
                            socketNumber: socketNumber
                        })
                    ];
                    SdfgViewerProvider.getInstance()?.openViewer(
                        vscode.Uri.file(data.filename),
                        msgs
                    );
                }
                break;
            case 'sdfgEditMode':
                const mode: SDFGEditModeItem | undefined =
                    await vscode.window.showQuickPick(
                        DaceDebuggingSession.DEBUG_MODE_ITEMS,
                        {
                            placeHolder: 'Select the next run mode',
                        }
                    );

                const selectedMode = mode ? mode.mode : SDFGEditMode.CONTINUE;
                const response: any = {
                    'mode': selectedMode,
                };

                if (selectedMode === SDFGEditMode.VERIFICATION) {
                    const reportHandler =
                        CorrectnessReportHandler.getInstance();
                    const uri = await reportHandler?.pickVerificationReport();
                    if (uri && uri.length > 0)
                        response.foldername = uri[0].fsPath;
                }
                this.send(socket, response);
                break;
            case 'accuracy_report':
                const sdfgName = data['sdfgName'];
                const path = data['reportFolder'];
                if (!sdfgName || !path)
                    return;
                CorrectnessReportHandler.getInstance()?.saveVerificationReport(
                    new CorrectnessReport(sdfgName, path)
                );
                break;
            case 'correctness_report':
                const reports = data['reports'];
                if (!reports) return;
                const sockNumber = new Date().valueOf();
                this.sockets.set(sockNumber, socket);
                const messagess: SDFVMessage[] = [
                    new SDFVMessage(data.sdfgName, {
                        type: 'sdfg_edit_show_continue',
                        socketNumber: sockNumber
                    }),
                    new SDFVMessage(data.sdfgName, {
                        type: 'correctness_report',
                        reports: reports,
                        diffText: DaCeVSCode.getExtensionContext()?.
                            workspaceState.get('diffText'),
                        diffRange: DaCeVSCode.getExtensionContext()?.
                            workspaceState.get('diffRange')
                    })
                ];
                SdfgViewerProvider.getInstance()?.openViewer(
                    vscode.Uri.file(data.filename),
                    messagess
                );
                break;
            case 'openSDFG':
                SdfgViewerProvider.getInstance()?.openViewer(
                    vscode.Uri.file(data.filename)
                );
                break;
            default:
                break;
        }
    }

    public handleMessage(message: any, _origin: vscode.Webview): void {
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

    public send(socket: net.Socket, response: any): void {
        socket.write(Buffer.from(JSON.stringify(response)));
    }

    public getPort(): number {
        return this.port;
    }

}
