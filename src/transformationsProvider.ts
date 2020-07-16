import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { request } from 'http';

import { Transformation } from './transformation';

export class TransformationsProvider
implements vscode.TreeDataProvider<Transformation> {

    private static INSTANCE = new TransformationsProvider();

    private constructor() {
        this.startPythonDaemon();
    }

    public static getInstance(): TransformationsProvider {
        return this.INSTANCE;
    }

    private _onDidChangeTreeData: vscode.EventEmitter<Transformation | undefined> =
        new vscode.EventEmitter<Transformation | undefined>();
    readonly onDidChangeTreeData: vscode.Event<Transformation | undefined> =
        this._onDidChangeTreeData.event;

    private transformations: Transformation[] = [];

    private activeSdfgFileName: string | undefined = undefined;
    private activeEditor: vscode.WebviewPanel | undefined = undefined;

    private daemonFound = false;

    private async getPythonPath(document: vscode.TextDocument | null) {
        try {
            let pyExt = vscode.extensions.getExtension('ms-python.python');
            if (!pyExt)
                return 'python';

            if (pyExt.packageJSON?.featureFlags?.usingNewInterpreterStorage) {
                if (!pyExt.isActive)
                    await pyExt.activate();
                const pythonPath = pyExt.exports.settings.getExecutionDetails ?
                    pyExt.exports.settings.getExecutionDetails(document?.uri).execCommand :
                    pyExt.exports.settings.getExecutionCommand(document?.uri);
                return pythonPath ? pythonPath.join(' ') : 'python';
            } else {
                if (document)
                    return vscode.workspace.getConfiguration(
                        'python',
                        document.uri
                    ).get<string>('pythonPath');
                else
                    return vscode.workspace.getConfiguration(
                        'python'
                    ).get<string>('pythonPath');
            }
        } catch (ignored) {
            return 'python';
        }
    }

    private async startPythonDaemon() {
        const pythonPath = await this.getPythonPath(null);
        const daemon = cp.spawn(
            pythonPath,
            ['-m', 'dace.transformation.interface.vscode']
        );

        // TODO: Randomize port choice.
        // We poll the daemon every second to see if it's awake.
        const connectionIntervalId = setInterval(() => {
            console.log('Checking for daemon');
            const req = request({
                host: 'localhost',
                port: 5000,
                path: '/',
                method: 'GET',
                timeout: 1000,
            }, response => {
                if (response.statusCode === 200) {
                    console.log('Daemon running');
                    this.daemonFound = true;
                    clearInterval(connectionIntervalId);
                    this.refresh();
                }
            });
            req.end();
        }, 1000);

        // If we were unable to connect after 10 seconds, stop trying.
        setTimeout(() => {
            if (!this.daemonFound) {
                // We were unable to start and connect to a daemon, show a
                // message hinting at a potentially missing DaCe instance.
                vscode.window.showErrorMessage(
                    'Unable to start and connect to DaCe. Do you have it ' +
                    'installed?',
                    'Install DaCe'
                ).then(opt => {
                    switch (opt) {
                        case 'Install DaCe':
                            vscode.commands.executeCommand('dace.installDace');
                            break;
                    }
                });
            }
            clearInterval(connectionIntervalId);
        }, 10000);
    }

    public refresh(element?: Transformation): void {
        this.loadTransformations();
    }

    getTreeItem(element: Transformation): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: Transformation | undefined): vscode.ProviderResult<Transformation[]> {
        return Promise.resolve(this.transformations);
    }

    public updateActiveSdfg(activeSdfgFileName: string,
                            activeEditor: vscode.WebviewPanel) {
        this.activeSdfgFileName = activeSdfgFileName;
        this.activeEditor = activeEditor;
        this.refresh();
    }

    private getActiveSdfg(): string | undefined {
        let sdfgJson = undefined;
        if (this.activeSdfgFileName)
            sdfgJson = fs.readFileSync(this.activeSdfgFileName, 'utf8');
        if (sdfgJson === '')
            sdfgJson = undefined;
        return sdfgJson;
    }

    private sendApplyTransformationRequest(transformation: Transformation,
                                           callback: CallableFunction,
                                           processingMessage?: string) {
        this.activeEditor?.webview.postMessage({
            type: 'processing',
            show: true,
            text: processingMessage ?
                processingMessage : 'Applying Transformation',
        });

        const sdfgJson = this.getActiveSdfg();
        if (sdfgJson) {
            let requestData = {
                sdfg: sdfgJson,
                transformation: transformation.json,
            };

            const postData = JSON.stringify(requestData);
            const req = request({
                host: 'localhost',
                port: 5000,
                path: '/apply_transformation',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': postData.length,
                },
            }, response => {
                response.setEncoding('utf8');
                response.on('data', (data) => {
                    if (response.statusCode === 200)
                        callback(data);
                });
            });
            req.write(postData);
            req.end();
        }
    }

    public applyTransformation(transformation: Transformation) {
        this.sendApplyTransformationRequest(transformation, (data: any) => {
            let parsed = JSON.parse(data);
            this.activeEditor?.webview.postMessage({
                type: 'processing',
                show: false,
                text: '',
            });

            if (this.activeSdfgFileName)
                fs.writeFileSync(this.activeSdfgFileName,
                    JSON.stringify(parsed.sdfg));
        });
    }

    public previewTransformation(transformation: Transformation) {
        this.sendApplyTransformationRequest(
            transformation,
            (data: any) => {
                let parsed = JSON.parse(data);
                this.activeEditor?.webview.postMessage({
                    type: 'preview_sdfg',
                    text: JSON.stringify(parsed.sdfg),
                });
                this.activeEditor?.webview.postMessage({
                    type: 'processing',
                    show: false,
                    text: '',
                });
            },
            'Generating Preview'
        );
    }

    private loadTransformations(): void {
        let sdfgJson = this.getActiveSdfg();
        if (!sdfgJson) {
            console.log('No active SDFG editor!');
            return;
        }

        const postData = JSON.stringify(sdfgJson);
        const req = request({
            host: 'localhost',
            port: 5000,
            path: '/transformations',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length,
            },
        }, response => {
            response.setEncoding('utf8');
            response.on('data', (data) => {
                if (response.statusCode === 200) {
                    this.transformations = [];
                    for (const elem of JSON.parse(data).transformations)
                        this.transformations.push(
                            new Transformation(elem.transformation, elem)
                        );
                    // Refresh the tree view to show the new contents.
                    this._onDidChangeTreeData.fire(undefined);
                }
            });
        });
        req.write(postData);
        req.end();
    }

}