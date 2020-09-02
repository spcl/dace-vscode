import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { request } from 'http';

import { TransformationsProvider } from './transformation/transformationsProvider';
import { Transformation, TransformationCategory } from './transformation/transformation';
import { TransformationHistoryProvider } from './transformation/transformationHistoryProvider';
import { TransformationHistoryItem } from './transformation/transformationHistoryItem';
import { DaCeVSCode } from './extension';

enum InteractionMode {
    PREVIEW,
    APPLY,
}

export class DaCeInterface {

    private static INSTANCE = new DaCeInterface();

    private constructor() {}

    public static getInstance(): DaCeInterface {
        return this.INSTANCE;
    }

    private daemonRunning = false;
    private daemonBooting = false;

    private activeSdfgFileName: string | undefined = undefined;
    private activeEditor: vscode.WebviewPanel | undefined = undefined;

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

    public getActiveSdfgFileName() {
        return this.activeSdfgFileName;
    }

    public getActiveEditor() {
        return this.activeEditor;
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
        const daemon = cp.spawn(
            pythonPath,
            ['-m', 'dace.transformation.interface.vscode']
        );

        daemon.on('exit', (code, signal) => {
            this.daemonRunning = false;
            this.daemonBooting = false;
        });

        daemon.stderr.on('data', data => {
            DaCeVSCode.getInstance().getOutputChannel().append(
                data.toString()
            );
            vscode.window.showErrorMessage(
                'Encountered an error in the DaCe daemon! ',
                'Show Error Output'
            ).then((opt) => {
                switch (opt) {
                    case 'Show Error Output':
                        DaCeVSCode.getInstance().getOutputChannel().show();
                        break;
                }
            });
        });

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
                    vscode.window.setStatusBarMessage(
                        'Connected to a DaCe daemon', 10000
                    );
                    this.daemonRunning = true;
                    this.daemonBooting = false;
                    clearInterval(connectionIntervalId);

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
                    'Install DaCe'
                ).then(opt => {
                    switch (opt) {
                        case 'Retry':
                            this.startPythonDaemon();
                            break;
                        case 'Install DaCe':
                            vscode.commands.executeCommand('dace.installDace');
                            break;
                    }
                });
            }
            clearInterval(connectionIntervalId);
        }, 10000);
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
                            } catch(e) {
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
        this.startPythonDaemon(() => {
            TransformationHistoryProvider.getInstance().refresh();
            TransformationsProvider.getInstance().refresh();
        });
    }

    public previewSdfg(sdfg: any) {
        this.activeEditor?.webview.postMessage({
            type: 'preview_sdfg',
            text: JSON.stringify(sdfg),
        });
    }

    public exitPreview() {
        this.activeEditor?.webview.postMessage({
            type: 'exit_preview',
        });
    }

    public showSpinner(message?: string) {
        this.activeEditor?.webview.postMessage({
            type: 'processing',
            show: true,
            text: message ?
                message : 'Processing, please wait',
        });
    }

    public hideSpinner() {
        this.activeEditor?.webview.postMessage({
            type: 'processing',
            show: false,
            text: '',
        });
    }

    private sendApplyTransformationRequest(transformation: Transformation,
                                           callback: CallableFunction,
                                           processingMessage?: string) {
        if (!this.daemonRunning) {
            this.promptStartDaemon();
            return;
        }

        this.showSpinner(
            processingMessage ? processingMessage : 'Applying Transformation'
        );
        const sdfg = this.getActiveSdfg();
        if (sdfg) {
            this.sendPostRequest(
                '/apply_transformation',
                {
                    sdfg: sdfg,
                    transformation: transformation.json,
                },
                callback
            );
        }
    }

    public applyTransformation(transformation: Transformation) {
        if (transformation.json)
            this.sendApplyTransformationRequest(transformation, (data: any) => {
                this.hideSpinner();
                if (this.activeSdfgFileName)
                    fs.writeFileSync(this.activeSdfgFileName,
                        JSON.stringify(data.sdfg, null, 2));
            });
    }

    public previewTransformation(transformation: Transformation) {
        if (transformation.json)
            this.sendApplyTransformationRequest(
                transformation,
                (data: any) => {
                    this.previewSdfg(data.sdfg);
                    this.hideSpinner();
                },
                'Generating Preview'
            );
    }

    private gotoHistoryPoint(histItem: TransformationHistoryItem,
                             mode: InteractionMode) {
        if (histItem.isCurrent) {
            if (mode === InteractionMode.PREVIEW)
                this.exitPreview();
            return;
        }

        const sdfg = this.getActiveSdfg();
        if (!sdfg)
            return;

        if (!histItem.json) {
            // This item refers to the original SDFG, so we revert to/show that.
            const originalSdfg = sdfg?.attributes?.orig_sdfg;
            if (originalSdfg) {
                switch (mode) {
                    case InteractionMode.APPLY:
                        // TODO: keep the 'future' history to 'redo'.
                        if (this.activeSdfgFileName)
                            fs.writeFileSync(this.activeSdfgFileName,
                                JSON.stringify(originalSdfg, null, 2));
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
                    callback = function(data: any) {
                        const daceInterface = DaCeInterface.getInstance();
                        const fileName =
                            daceInterface.getActiveSdfgFileName();
                        if (fileName)
                            fs.writeFileSync(fileName,
                                JSON.stringify(data.sdfg, null, 2));
                        daceInterface.hideSpinner();
                    };
                    break;
                case InteractionMode.PREVIEW:
                default:
                    callback = function(data: any) {
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

    public loadTransformations(): void {
        if (!this.daemonRunning) {
            this.promptStartDaemon();
            return;
        }

        this.showSpinner('Loading transformations');

        let sdfg = this.getActiveSdfg();
        if (!sdfg) {
            console.log('No active SDFG editor!');
            return;
        }

        function callback(data: any) {
            const tProvider = TransformationsProvider.getInstance();
            tProvider.clearTransformations();

            for (const elem of data.transformations) {
                let docstring = '';
                if (data.docstrings)
                    docstring = data.docstrings[
                        elem.transformation
                    ];
                tProvider.addUncategorizedTransformation(new Transformation(
                        elem.transformation,
                        elem,
                        docstring
                ));
            }
            // Refresh the tree view to show the new contents.
            tProvider.notifyTreeDataChanged();

            const daceInterface = DaCeInterface.getInstance();
            daceInterface.getActiveEditor()?.webview.postMessage({
                type: 'get_viewport_elem',
            });
            daceInterface.hideSpinner();
        }

        this.sendPostRequest(
            '/transformations',
            {
                'sdfg': sdfg,
                'selected_elements': TransformationsProvider.getInstance().getLastSelectedElements(),
            },
            callback
        );
    }

    public updateActiveSdfg(activeSdfgFileName: string,
                            activeEditor: vscode.WebviewPanel) {
        this.activeSdfgFileName = activeSdfgFileName;
        this.activeEditor = activeEditor;
        TransformationsProvider.getInstance().refresh();
        TransformationHistoryProvider.getInstance().refresh();
    }

    private getActiveSdfg(): any | undefined {
        let sdfgJson = undefined;
        if (this.activeSdfgFileName)
            sdfgJson = fs.readFileSync(this.activeSdfgFileName, 'utf8');
        if (sdfgJson === '' || !sdfgJson)
            sdfgJson = undefined;
        else
            sdfgJson = JSON.parse(sdfgJson);
        return sdfgJson;
    }

    public activeSdfgGetHistory() {
        const trafoProvider = TransformationHistoryProvider.getInstance();
        trafoProvider.clearHistory();
        const activeSdfg = this.getActiveSdfg();
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