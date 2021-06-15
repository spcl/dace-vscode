// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as os from 'os';
import * as vscode from 'vscode';
import { request } from 'http';

import { DaCeVSCode } from './extension';
import { SdfgViewerProvider } from './components/sdfgViewer';
import { MessageReceiverInterface } from './components/messaging/messageReceiverInterface';
import { TransformationListProvider } from './components/transformationList';
import { TransformationHistoryProvider } from './components/transformationHistory';
import { OptimizationPanel } from './components/optimizationPanel';

enum InteractionMode {
    PREVIEW,
    APPLY,
}

export class DaCeInterface
implements MessageReceiverInterface {

    private static INSTANCE = new DaCeInterface();

    private constructor() {}

    public handleMessage(message: any, origin: vscode.Webview): void {
        switch (message.type) {
            case 'write_edit_to_sdfg':
                if (message.sdfg)
                    this.writeToActiveDocument(JSON.parse(message.sdfg));
                break;
            case 'run_sdfg':
                if (message.name !== undefined)
                    this.runSdfgInTerminal(message.name, undefined, origin);
                break;
            case 'expand_library_node':
                this.expandLibraryNode(message.nodeid);
                break;
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
            case 'preview_history_point':
                this.previewHistoryPoint(message.index);
                break;
            case 'apply_history_point':
                this.applyHistoryPoint(message.index);
                break;
            case 'get_flops':
                this.getFlops();
                break;
            case 'get_enum':
                if (message.name)
                    this.getEnum(message.name, origin);
                break;
            case 'query_sdfg_metadata':
                this.querySdfgMetadata();
                break;
            default:
                break;
        }
    }

    public static getInstance(): DaCeInterface {
        return this.INSTANCE;
    }

    private runTerminal?: vscode.Terminal = undefined;
    private daemonTerminal?: vscode.Terminal = undefined;

    private daemonRunning = false;
    private daemonBooting = false;

    private port: number = vscode.workspace.getConfiguration(
        'dace.interface'
    ).port;

    public async getPythonExecCommand(
        uri: vscode.Uri | undefined
    ): Promise<string> {
        try {
            let pyExt = vscode.extensions.getExtension('ms-python.python');
            if (!pyExt) {
                // TODO: do we want to tell the user that using the python
                // plugin might be advisable here?
                return 'python';
            }

            if (pyExt.packageJSON?.featureFlags?.usingNewInterpreterStorage) {
                if (!pyExt.isActive)
                    await pyExt.activate();
                const pyCmd = pyExt.exports.settings.getExecutionDetails ?
                    pyExt.exports.settings.getExecutionDetails(
                        uri
                    ).execCommand :
                    pyExt.exports.settings.getExecutionCommand(uri);
                if (pyCmd) {
                    // Ensure spaces in the python command don't trip up the
                    // terminal.
                    switch (os.platform()) {
                        case 'win32':
                            for (let i = 0; i < pyCmd.length; i++) {
                                if (/\s/g.test(pyCmd[i]))
                                    pyCmd[i] = '& "' + pyCmd[i] + '"';
                            }
                            break;
                        default:
                            for (let i = 0; i < pyCmd.length; i++) {
                                if (/\s/g.test(pyCmd[i]))
                                    pyCmd[i] = '"' + pyCmd[i] + '"';
                            }
                            break;
                    }
                    return pyCmd.join(' ');
                } else {
                    return 'python';
                }
            } else {
                let path = undefined;
                if (uri)
                    path = vscode.workspace.getConfiguration(
                        'python',
                        uri
                    ).get<string>('pythonPath');
                else
                    path = vscode.workspace.getConfiguration(
                        'python'
                    ).get<string>('pythonPath');
                if (!path)
                    return 'python';
            }
        } catch (ignored) {
            return 'python';
        }
        return 'python';
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

    private getRunDaceScriptUri(): vscode.Uri | undefined{
        const extensionUri =
            DaCeVSCode.getInstance().getExtensionContext()?.extensionUri;
        if (!extensionUri) {
            vscode.window.showErrorMessage(
                'Failed to load the file path to the extension'
            );
            return undefined;
        }
        return vscode.Uri.joinPath(extensionUri, 'backend', 'run_dace.py');
    }

    public async startDaemonInTerminal(callback?: CallableFunction) {
        if (this.daemonTerminal === undefined)
            this.daemonTerminal = vscode.window.createTerminal(
                'SDFG Optimizer'
            );

        const scriptUri = this.getRunDaceScriptUri();
        if (scriptUri) {
            vscode.window.setStatusBarMessage(
                'Trying to start and connect to a DaCe daemon', 5000
            );
            const pyCmd: string = await this.getPythonExecCommand(scriptUri);

            this.daemonTerminal?.sendText(
                pyCmd + ' ' + scriptUri.fsPath + ' -p ' + this.port.toString()
            );
            this.pollDaemon(callback, true);
        } else {
            this.daemonBooting = false;
        }
    }

    private runSdfgInTerminal(name: string, path?: string,
                              origin?: vscode.Webview) {
        if (!this.runTerminal)
            this.runTerminal = vscode.window.createTerminal('Run SDFG');
        this.runTerminal.show();

        if (path === undefined) {
            if (origin === undefined)
                return;

            path = SdfgViewerProvider.getInstance()?.findEditorForWebview(
                origin
            )?.wrapperFile;
        }

        this.runTerminal.sendText('python ' + path);

        // Additionally create a launch configuration for VSCode.
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const launchConfig = vscode.workspace.getConfiguration(
                'launch', workspaceFolders[0].uri
            );
            const runSdfgConfig = {
                'name': 'SDFG: ' + name,
                'type': 'sdfg-python',
                'request': 'launch',
                'program': path,
                'console': 'integratedTerminal',
            };

            let pathIncluded = false;
            for (const cfg of launchConfig.configurations) {
                if (cfg['program'] === path) {
                    pathIncluded = true;
                    break;
                }
            }

            if (!pathIncluded) {
                launchConfig.configurations.push(runSdfgConfig);
                launchConfig.update(
                    'configurations',
                    launchConfig.configurations,
                    false
                );
            }
        }
    }

    private pollDaemon(callback?: CallableFunction, terminalMode?: boolean) {
        // We poll the daemon every second to see if it's awake.
        const connectionIntervalId = setInterval(() => {
            console.log('Checking for daemon');
            const req = request({
                host: 'localhost',
                port: this.port,
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
                    'Install DaCe'
                ).then(opt => {
                    switch (opt) {
                        case 'Retry':
                            clearInterval(connectionIntervalId);
                            this.startDaemonInTerminal();
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

    private sendRequest(url: string,
                        data?: any,
                        callback?: CallableFunction,
                        customErrorHandler?: CallableFunction) {
        let method = 'GET';
        let postData = undefined;
        if (data !== undefined)
            method = 'POST';

        let parameters = {
            host: 'localhost',
            port: this.port,
            path: url,
            method: method,
            headers: {},
        };

        if (data !== undefined) {
            postData = JSON.stringify(data);
            parameters.headers = {
                'Content-Type': 'application/json',
                'Content-Length': postData.length,
            };
        }

        const req = request(parameters, response => {
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
        if (postData !== undefined)
            req.write(postData);
        req.end();
    }

    private sendGetRequest(url: string,
                           callback?: CallableFunction,
                           customErrorHandler?: CallableFunction) {
        this.sendRequest(url, undefined, callback, customErrorHandler);
    }

    private sendPostRequest(url: string,
                            requestData: any,
                            callback?: CallableFunction,
                            customErrorHandler?: CallableFunction) {
        this.sendRequest(url, requestData, callback, customErrorHandler);
    }

    public promptStartDaemon() {
        if (this.daemonBooting)
            return;

        // If the optimization panel isn't open, we don't want to interact
        // with the daemon. Don't prompt in that case.
        if (!OptimizationPanel.getInstance().isVisible())
            return;

        vscode.window.showWarningMessage(
            'The DaCe daemon isn\'t running, so this action can\'t be ' +
            'performed. Do you want to start it?',
            'Yes',
            'No'
        ).then(opt => {
            switch (opt) {
                case 'Yes':
                    DaCeInterface.getInstance().startDaemonInTerminal();
                    break;
                case 'No':
                    break;
            }
        });
    }

    public start() {
        // The daemon shouldn't start if it's already booting due to being
        // started from some other source, or if the optimization panel isn't
        // visible.
        if (this.daemonRunning || this.daemonBooting ||
            !OptimizationPanel.getInstance().isVisible())
            return;

        this.daemonBooting = true;

        const callback = () => {
            TransformationHistoryProvider.getInstance()?.refresh();
            TransformationListProvider.getInstance()?.refresh(true);
            this.querySdfgMetadata();
        };
        this.startDaemonInTerminal(callback);
    }

    public previewSdfg(sdfg: any, history_mode: boolean = false) {
        DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
            type: 'preview_sdfg',
            text: JSON.stringify(sdfg),
            hist_state: history_mode,
        });
    }

    public exitPreview(refreshTransformations: boolean = false) {
        DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
            type: 'exit_preview',
            refresh_transformations: refreshTransformations,
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

        DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
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
        });
    }

    public expandLibraryNode(nodeid: any) {
        DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
            if (sdfg) {
                this.showSpinner('Expanding library node');
                this.sendPostRequest(
                    '/expand_library_node',
                    {
                        sdfg: sdfg,
                        nodeid: nodeid,
                    },
                    (data: any) => {
                        this.hideSpinner();
                        this.writeToActiveDocument(data.sdfg);
                    }
                );
            }
        });
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

    private gotoHistoryPoint(index: Number | undefined, mode: InteractionMode) {
        const trafoHistProvider = TransformationHistoryProvider.getInstance();
        if (trafoHistProvider)
            trafoHistProvider.activeHistoryItemIndex = index;

        if (index === undefined) {
            if (mode === InteractionMode.PREVIEW)
                this.exitPreview(true);
            return;
        }

        DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
            if (!sdfg)
                return;

            if (index < 0) {
                // This item refers to the original SDFG, so we revert to that.
                const originalSdfg = sdfg?.attributes?.orig_sdfg;
                if (originalSdfg) {
                    switch (mode) {
                        case InteractionMode.APPLY:
                            this.writeToActiveDocument(originalSdfg);
                            break;
                        case InteractionMode.PREVIEW:
                        default:
                            this.previewSdfg(originalSdfg, true);
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
                            daceInterface.previewSdfg(data.sdfg, true);
                            daceInterface.hideSpinner();
                        };
                        break;
                }

                this.sendPostRequest(
                    '/reapply_history_until',
                    {
                        sdfg: sdfg,
                        index: index,
                    },
                    callback
                );
            }
        });
    }

    public applyHistoryPoint(index: Number | undefined) {
        this.gotoHistoryPoint(index, InteractionMode.APPLY);
    }

    public previewHistoryPoint(index: Number | undefined) {
        this.gotoHistoryPoint(index, InteractionMode.PREVIEW);
    }

    public getFlops(): void {
        if (!this.daemonRunning) {
            this.promptStartDaemon();
            return;
        }

        this.showSpinner('Calculating FLOP count');

        DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
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
        });
    }

    public compileSdfgFromFile(uri: vscode.Uri, callback: CallableFunction,
                               suppressInstrumentation: boolean = false) {
        this.sendPostRequest(
            '/compile_sdfg_from_file',
            {
                'path': uri.fsPath,
                'suppress_instrumentation': suppressInstrumentation,
            },
            callback
        );
    }

    public async querySdfgMetadata() {
        async function callback(data: any) {
            SdfgViewerProvider.getInstance()?.handleMessage({
                type: 'set_sdfg_metadata',
                meta_dict: data.meta_dict,
            });
        };

        if (this.daemonRunning)
            this.sendGetRequest(
                '/get_metadata',
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

        this.sendPostRequest(
            '/transformations',
            {
                'sdfg': JSON.parse(sdfg),
                'selected_elements': JSON.parse(selectedElements),
            },
            callback
        );
    }

    public getEnum(name: string, origin: vscode.Webview) {
        if (this.daemonRunning)
            this.sendGetRequest('/get_enum/' + name, (response: any) => {
                if (response.enum)
                    origin.postMessage({
                        'type': 'get_enum_callback',
                        'name': name,
                        'enum': response.enum,
                    });
            });
    }

    public isRunning() {
        return this.daemonRunning;
    }

}