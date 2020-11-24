import * as path from 'path';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { request } from 'http';

import { TransformationHistoryProvider } from './transformation/transformationHistory';
import { TransformationHistoryItem } from './transformation/transformationHistoryItem';
import { DaCeVSCode } from './extension';
import { SdfgViewerProvider } from './components/sdfgViewer';
import { MessageReceiverInterface } from './components/messaging/messageReceiverInterface';
import { TransformationListProvider } from './components/transformationList';

enum InteractionMode {
    PREVIEW,
    APPLY,
}

export class DaCeInterface
implements MessageReceiverInterface {

    private static INSTANCE = new DaCeInterface();

    private constructor() { }

    public handleMessage(message: any, origin: vscode.Webview): void {
        switch (message.type) {
            case 'apply_transformation':
                if (message.transformation !== undefined)
                    this.applyTransformation(message.transformation);
                break;
            case 'preview_transformation':
                if (message.transformation !== undefined)
                    this.previewTransformation(message.transformation);
                break;
            case 'load_transformations':
                if (message.sdfg !== undefined &&
                    message.selectedElements !== undefined)
                    this.loadTransformations(
                        message.sdfg,
                        message.selectedElements
                    );
                break;
            case 'get_flops':
                this.getFlops();
                break;
            default:
                break;
        }
    }

    public static getInstance(): DaCeInterface {
        return this.INSTANCE;
    }

    private daemonRunning = false;
    private daemonBooting = false;

    private async getPythonPath(document: vscode.TextDocument | null) {
        try {
            let pyExt = vscode.extensions.getExtension('ms-python.python');
            if (!pyExt)
                return 'python';

            if (pyExt.packageJSON?.featureFlags?.usingNewInterpreterStorage) {
                if (!pyExt.isActive)
                    await pyExt.activate();
                const pythonPath = pyExt.exports.settings.getExecutionDetails ?
                    pyExt.exports.settings.getExecutionDetails(
                        document?.uri
                    ).execCommand :
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

    public genericErrorHandler(message: string, details?: string) {
        this.hideSpinner();
        console.error(message);
        if (details) {
            console.error(details);
            vscode.window.showErrorMessage(
                message + ' (' + details + ')'
            );
        } else {
            vscode.window.showErrorMessage(
                message
            );
        }
    }

    private genericBackendErrorPopup() {
        vscode.window.showErrorMessage(
            'Encountered an error in the DaCe daemon! ',
            'Show Error Output',
            'Retry in Terminal Mode'
        ).then((opt) => {
            switch (opt) {
                case 'Show Error Output':
                    DaCeVSCode.getInstance().getOutputChannel().show();
                    break;
                case 'Retry in Terminal Mode':
                    vscode.commands.executeCommand(
                        'dace.openOptimizerInTerminal'
                    );
                    break;
            }
        });
    }

    private getRunDaceScriptPath(): string | undefined{
        const extensionPath =
            DaCeVSCode.getInstance().getExtensionContext()?.extensionPath;
        if (!extensionPath) {
            DaCeVSCode.getInstance().getOutputChannel().append(
                'Failed to load the file path to the extension'
            );
            this.genericBackendErrorPopup();
            return undefined;
        }
        return path.join(extensionPath, 'backend', 'run_dace.py');
    }

    public startDaemonInTerminal(callback?: CallableFunction) {
        const term = vscode.window.createTerminal('SDFG Optimizer');
        term.show();
        const scriptPath = this.getRunDaceScriptPath();
        if (scriptPath) {
            this.daemonBooting = true;
            term.sendText('python ' + scriptPath);
            this.pollDaemon(callback, true);
        }
    }

    private pollDaemon(callback?: CallableFunction, terminalMode?: boolean) {
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
                    vscode.window.setStatusBarMessage(
                        'Connected to a DaCe daemon', 10000
                    );
                    this.daemonRunning = true;
                    this.daemonBooting = false;
                    clearInterval(connectionIntervalId);

                    if (vscode.workspace.getConfiguration(
                            'dace.interface'
                        ).terminalMode === true
                    ) {
                        if (terminalMode !== true) {
                            vscode.window.showInformationMessage(
                                'DaCe successfully started as a subprocess, ' +
                                'but you have it configured to start in ' +
                                'terminal mode. Do you want to update this ' +
                                'setting?',
                                'Yes',
                                'No'
                            ).then((opt) => {
                                switch (opt) {
                                    case 'Yes':
                                        vscode.workspace.getConfiguration(
                                            'dace.interface'
                                        ).update(
                                            'terminalMode', false,
                                            vscode.ConfigurationTarget.Global
                                        );
                                        break;
                                    case 'No':
                                    default:
                                        break;
                                }
                            });
                        }
                    } else {
                        if (terminalMode === true) {
                            vscode.window.showInformationMessage(
                                'DaCe successfully started in terminal mode, ' +
                                'but you have it configured to start as a ' +
                                'subprocess. Do you want to update this ' +
                                'setting?',
                                'Yes',
                                'No'
                            ).then((opt) => {
                                switch (opt) {
                                    case 'Yes':
                                        vscode.workspace.getConfiguration(
                                            'dace.interface'
                                        ).update(
                                            'terminalMode', true,
                                            vscode.ConfigurationTarget.Global
                                        );
                                        break;
                                    case 'No':
                                    default:
                                        break;
                                }
                            });
                        }
                    }

                    // If a callback was provided, continue execution there.
                    if (callback)
                        callback();
                }
            });
            req.end();
        }, 2000);

        // If we were unable to connect after 10 seconds, stop trying.
        setTimeout(() => {
            if (!this.daemonRunning) {
                // We were unable to start and connect to a daemon, show a
                // message hinting at a potentially missing DaCe instance.
                vscode.window.showErrorMessage(
                    'Unable to start and connect to DaCe. Do you have it ' +
                    'installed?',
                    'Retry',
                    'Retry in Terminal Mode',
                    'Install DaCe'
                ).then(opt => {
                    switch (opt) {
                        case 'Retry':
                            clearInterval(connectionIntervalId);
                            this.startPythonDaemon();
                            break;
                        case 'Retry in Terminal Mode':
                            vscode.commands.executeCommand(
                                'dace.openOptimizerInTerminal'
                            );
                            // Do not clear the connection interval immediately
                            setTimeout(() => {
                                clearInterval(connectionIntervalId);
                            }, 10000);
                            break;
                        case 'Install DaCe':
                            clearInterval(connectionIntervalId);
                            vscode.commands.executeCommand('dace.installDace');
                            break;
                    }
                });
            } else {
                clearInterval(connectionIntervalId);
            }
        }, 10000);
    }

    private async startPythonDaemon(callback?: CallableFunction) {
        if (this.daemonRunning) {
            if (callback)
                callback();
            return;
        }

        this.daemonBooting = true;

        vscode.window.setStatusBarMessage(
            'Trying to start and connect to a DaCe daemon', 5000
        );

        const pythonPath = await this.getPythonPath(null);
        const scriptPath = this.getRunDaceScriptPath();
        if (!scriptPath)
            return;

        // TODO: Randomize port choice.
        const daemon = cp.spawn(
            pythonPath,
            [scriptPath]
        );

        daemon.on('exit', (code, signal) => {
            this.daemonRunning = false;
            this.daemonBooting = false;
        });

        daemon.stderr.on('data', data => {
            DaCeVSCode.getInstance().getOutputChannel().append(
                data.toString()
            );
            this.genericBackendErrorPopup();
        });

        this.pollDaemon(callback, false);
    }

    private sendPostRequest(url: string,
                            requestData: any,
                            callback?: CallableFunction,
                            customErrorHandler?: CallableFunction) {
        const postData = JSON.stringify(requestData);
        const req = request({
            host: 'localhost',
            port: 5000,
            path: url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length,
            },
        }, response => {
            response.setEncoding('utf8');
            // Accumulate all the data, in case data is chunked up.
            let accumulatedData = '';
            if (callback) {
                response.on('data', (data) => {
                    if (response.statusCode === 200) {
                        accumulatedData += data;
                        // Check if this is all the data we're going to receive,
                        // or if the data is chunked up into pieces.
                        const contentLength =
                            Number(response.headers?.['content-length']);
                        if (!contentLength ||
                            accumulatedData.length >= contentLength) {
                            let error = undefined;
                            let parsed = undefined;
                            try {
                                parsed = JSON.parse(accumulatedData);
                                if (parsed.error) {
                                    error = parsed.error;
                                    parsed = undefined;
                                }
                            } catch (e) {
                                error = {
                                    message: 'Failed to parse response',
                                    details: e,
                                };
                            }

                            if (parsed) {
                                callback(parsed);
                            } else if (error) {
                                if (customErrorHandler)
                                    customErrorHandler(error);
                                else
                                    DaCeInterface.getInstance()
                                        .genericErrorHandler(
                                            error.message, error.details
                                        );
                            }
                        }
                    } else {
                        const errorMessage =
                            'An internal DaCe error was encountered!';
                        const errorDetails = 'DaCe request failed with code ' +
                            response.statusCode;
                        if (customErrorHandler)
                            customErrorHandler({
                                message: errorMessage,
                                details: errorDetails,
                            });
                        else
                            DaCeInterface.getInstance().genericErrorHandler(
                                errorMessage, errorDetails
                            );
                    }
                });
            }
        });
        req.write(postData);
        req.end();
    }

    public promptStartDaemon() {
        if (this.daemonBooting)
            return;
        vscode.window.showWarningMessage(
            'The DaCe daemon isn\'t running, so this action can\'t be ' +
            'performed. Do you want to start it?',
            'Yes',
            'No'
        ).then(opt => {
            switch (opt) {
                case 'Yes':
                    DaCeInterface.getInstance().startPythonDaemon();
                    break;
                case 'No':
                    break;
            }
        });
    }

    public start() {
        const callback = () => {
            TransformationHistoryProvider.getInstance().refresh();
            TransformationListProvider.getInstance()?.refresh();
        };
        if (vscode.workspace.getConfiguration(
                'dace.interface'
            ).terminalMode === true
        )
            this.startDaemonInTerminal(callback);
        else
            this.startPythonDaemon(callback);
    }

    public previewSdfg(sdfg: any) {
        DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
            type: 'preview_sdfg',
            text: JSON.stringify(sdfg),
        });
    }

    public exitPreview() {
        DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
            type: 'exit_preview',
        });
    }

    public showSpinner(message?: string) {
        DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
            type: 'processing',
            show: true,
            text: message ?
                message : 'Processing, please wait',
        });
    }

    public hideSpinner() {
        DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
            type: 'processing',
            show: false,
            text: '',
        });
    }

    private sendApplyTransformationRequest(transformation: any,
                                           callback: CallableFunction,
                                           processingMessage?: string) {
        if (!this.daemonRunning) {
            this.promptStartDaemon();
            return;
        }

        this.showSpinner(
            processingMessage ? processingMessage : 'Applying Transformation'
        );
        const sdfg = DaCeVSCode.getInstance().getActiveSdfg();
        if (sdfg) {
            this.sendPostRequest(
                '/apply_transformation',
                {
                    sdfg: sdfg,
                    transformation: transformation,
                },
                callback
            );
        }
    }

    public applyTransformation(transformation: any) {
        this.sendApplyTransformationRequest(transformation, (data: any) => {
            this.hideSpinner();
            this.writeToActiveDocument(data.sdfg);
        });
    }

    public previewTransformation(transformation: any) {
        this.sendApplyTransformationRequest(
            transformation,
            (data: any) => {
                this.previewSdfg(data.sdfg);
                this.hideSpinner();
            },
            'Generating Preview'
        );
    }

    public writeToActiveDocument(json: any) {
        const activeEditor = DaCeVSCode.getInstance().getActiveEditor();
        if (activeEditor) {
            const sdfvInstance = SdfgViewerProvider.getInstance();
            const document = sdfvInstance?.findEditorForWebview(
                activeEditor
            )?.document;
            if (document) {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    JSON.stringify(json, null, 2)
                );
                vscode.workspace.applyEdit(edit);
            }
        }
    }

    private gotoHistoryPoint(histItem: TransformationHistoryItem,
                             mode: InteractionMode) {
        if (histItem.isCurrent) {
            if (mode === InteractionMode.PREVIEW)
                this.exitPreview();
            return;
        }

        const sdfg = DaCeVSCode.getInstance().getActiveSdfg();
        if (!sdfg)
            return;

        if (!histItem.json) {
            // This item refers to the original SDFG, so we revert to/show that.
            const originalSdfg = sdfg?.attributes?.orig_sdfg;
            if (originalSdfg) {
                switch (mode) {
                    case InteractionMode.APPLY:
                        this.writeToActiveDocument(originalSdfg);
                        break;
                    case InteractionMode.PREVIEW:
                    default:
                        this.previewSdfg(originalSdfg);
                        break;
                }
            }
        } else {
            if (!this.daemonRunning) {
                this.promptStartDaemon();
                return;
            }

            this.showSpinner('Loading SDFG');
            let callback: any;
            switch (mode) {
                case InteractionMode.APPLY:
                    callback = function (data: any) {
                        const daceInterface = DaCeInterface.getInstance();
                        daceInterface.writeToActiveDocument(data.sdfg);
                        daceInterface.hideSpinner();
                    };
                    break;
                case InteractionMode.PREVIEW:
                default:
                    callback = function (data: any) {
                        const daceInterface = DaCeInterface.getInstance();
                        daceInterface.previewSdfg(data.sdfg);
                        daceInterface.hideSpinner();
                    };
                    break;
            }

            const history = sdfg.attributes?.transformation_hist;
            if (history) {
                for (let i = 0; i < history.length; i++) {
                    if (JSON.stringify(history[i]) ===
                        JSON.stringify(histItem.json)) {
                        this.sendPostRequest(
                            '/reapply_history_until',
                            {
                                sdfg: sdfg,
                                index: i,
                            },
                            callback
                        );
                        return;
                    }
                }
            }
        }
    }

    public applyHistoryPoint(histItem: TransformationHistoryItem) {
        this.gotoHistoryPoint(histItem, InteractionMode.APPLY);
    }

    public previewHistoryPoint(histItem: TransformationHistoryItem) {
        this.gotoHistoryPoint(histItem, InteractionMode.PREVIEW);
    }

    public getFlops(): void {
        if (!this.daemonRunning) {
            this.promptStartDaemon();
            return;
        }

        this.showSpinner('Calculating FLOPS');

        let sdfg = DaCeVSCode.getInstance().getActiveSdfg();
        if (!sdfg) {
            console.log('No active SDFG editor!');
            return;
        }

        function callback(data: any) {
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                type: 'flopsCallback',
                map: data.arith_ops_map,
            });
            DaCeInterface.getInstance().hideSpinner();
        }

        this.sendPostRequest(
            '/get_arith_ops',
            {
                'sdfg': sdfg,
            },
            callback
        );
    }

    public async loadTransformations(sdfg: any, selectedElements: any) {
        TransformationListProvider.getInstance()?.handleMessage({
            type: 'show_loading',
        });

        if (!this.daemonRunning) {
            this.promptStartDaemon();
            return;
        }

        async function callback(data: any) {
            for (const elem of data.transformations) {
                let docstring = '';
                if (data.docstrings)
                    docstring = data.docstrings[
                        elem.transformation
                    ];
                elem.docstring = docstring;
            }

            SdfgViewerProvider.getInstance()?.handleMessage({
                type: 'get_applicable_transformations_callback',
                transformations: data.transformations,
            });
        }

        const parsedSelected: any = JSON.parse(selectedElements);
        const cleanedSelected: any[] = [];
        for (const idx in parsedSelected) {
            const elem = parsedSelected[idx];
            let type = 'other';
            if (elem.data !== undefined && elem.data.node !== undefined)
                type = 'node';
            else if (elem.data !== undefined && elem.data.state !== undefined)
                type = 'state';
            cleanedSelected.push({
                'type': type,
                'state_id': elem.parent_id,
                'sdfg_id': elem.sdfg.sdfg_list_id,
                'id': elem.id,
            });
        }

        this.sendPostRequest(
            '/transformations',
            {
                'sdfg': JSON.parse(sdfg),
                'selected_elements': cleanedSelected,
            },
            callback
        );
    }

    public activeSdfgGetHistory() {
        const trafoProvider = TransformationHistoryProvider.getInstance();
        trafoProvider.clearHistory();
        const activeSdfg = DaCeVSCode.getInstance().getActiveSdfg();
        if (activeSdfg) {
            const history = activeSdfg?.attributes?.transformation_hist;
            if (history) {
                if (history.length > 0)
                    trafoProvider.addHistoryItem(new TransformationHistoryItem(
                        'Original SDFG',
                        undefined,
                        '',
                        false
                    ));
                for (let i = 0; i < history.length; i++) {
                    const el = history[i];
                    const current = (i === history.length - 1) ? true : false;
                    trafoProvider.addHistoryItem(new TransformationHistoryItem(
                        el.transformation,
                        el,
                        '',
                        current
                    ));
                }
            }
        }
        trafoProvider.notifyTreeDataChanged();
    }

}