// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { request } from 'http';
import * as net from 'net';
import * as os from 'os';
import * as vscode from 'vscode';
import { ICPCRequest } from './common/messaging/icpc_messaging_component';

import { OptimizationPanel } from './components/optimization_panel';
import { SdfgViewerProvider } from './components/sdfg_viewer';
import {
    TransformationHistoryProvider
} from './components/transformation_history';
import {
    TransformationListProvider
} from './components/transformation_list';
import { DaCeVSCode } from './extension';
import {
    showUntrustedWorkspaceWarning,
    walkDirectory
} from './utils/utils';
import {
    JsonTransformation
} from './webclients/components/transformations/transformations';

enum InteractionMode {
    PREVIEW,
    APPLY,
}

export class DaCeInterface {

    private static INSTANCE = new DaCeInterface();

    private constructor() { }

    /*
    public handleMessage(message: any, origin: vscode.Webview): void {
        switch (message.type) {
            case 'run_sdfg':
                if (message.name !== undefined)
                    this.runSdfgInTerminal(message.name, undefined, origin);
                break;
            case 'get_flops':
                this.getFlops();
                break;
            case 'query_sdfg_metadata':
                this.querySdfgMetadata();
                break;
        }
    }
    */

    public static getInstance(): DaCeInterface {
        return this.INSTANCE;
    }

    private runTerminal?: vscode.Terminal = undefined;
    private daemonTerminal?: vscode.Terminal = undefined;

    private daemonRunning = false;
    private daemonBooting = false;

    private port: number = -1;

    private async getRandomPort(): Promise<number> {
        return new Promise(resolve => {
            const rangeMin = 1024;
            const rangeMax = 65535;
            const portCandidate = Math.floor(
                Math.random() * (rangeMax - rangeMin) + rangeMin
            );

            const tempServer = net.createServer();
            tempServer.listen(portCandidate, () => {
                tempServer.once('close', () => {
                    this.port = portCandidate;
                    resolve(portCandidate);
                });
                tempServer.close();
            });
            tempServer.on('error', () => {
                return this.getRandomPort();
            });
        });
    }

    /**
     * Clean out shell commands by ensuring spaces are properly quoted.
     * Commands containing spaces are surrounded by quotes, and the command
     * is assembled into command + arguments as one string.
     * @param cmds      List of command parts, typically command plus arguments.
     * @param spaceSafe Whether or not to perform space-quoting.
     * @returns         Assembled command as a string.
     */
    private cleanCmd(cmds: string[], spaceSafe = true): string {
        if (spaceSafe)
            switch (os.platform()) {
                case 'win32':
                    for (let i = 0; i < cmds.length; i++) {
                        if (/\s/g.test(cmds[i]))
                            cmds[i] = '& "' + cmds[i] + '"';
                    }
                    break;
                default:
                    for (let i = 0; i < cmds.length; i++) {
                        if (/\s/g.test(cmds[i]))
                            cmds[i] = '"' + cmds[i] + '"';
                    }
                    break;
            }
        return cmds.join(' ');
    }

    public async getPythonExecCommand(
        uri: vscode.Uri | undefined,
        spaceSafe = true
    ): Promise<string> {
        const overridePath = vscode.workspace.getConfiguration(
            'dace.backend'
        )?.interpreterPath;
        if (overridePath && overridePath !== '')
            return this.cleanCmd([overridePath], spaceSafe);

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
                // Ensure spaces in the python command don't trip up the
                // terminal.
                if (pyCmd)
                    return this.cleanCmd(pyCmd, spaceSafe);
                else
                    return 'python';
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
        let text = message;
        if (details) {
            console.error(details);
            text += ' (' + details + ')';
        }
        vscode.window.showErrorMessage(
            text, 'Show Trace'
        ).then((val: 'Show Trace' | undefined) => {
            if (val === 'Show Trace')
                this.daemonTerminal?.show();
        });
    }

    private getRunDaceScriptUri(): vscode.Uri | undefined {
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

    public async startDaemonInTerminal(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.daemonTerminal === undefined)
                this.daemonTerminal = vscode.window.createTerminal({
                    hideFromUser: false,
                    name: 'SDFG Optimizer',
                    isTransient: true,
                });

            const scriptUri = this.getRunDaceScriptUri();
            if (scriptUri) {
                vscode.window.setStatusBarMessage(
                    'Trying to start and connect to a DaCe daemon', 5000
                );

                this.getPythonExecCommand(
                    scriptUri, true
                ).then(pyCmd => {
                    this.getRandomPort().then(port => {
                        this.daemonTerminal?.sendText(
                            pyCmd + ' ' + scriptUri.fsPath + ' -p ' +
                            port.toString()
                        );
                        this.pollDaemon(resolve, reject);
                    });
                });
            } else {
                this.daemonBooting = false;
            }
        });
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

    private pollDaemon(
        callback?: CallableFunction, failureCallback?: CallableFunction
    ): void {
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

                    // If a callback was provided, continue execution there.
                    if (callback)
                        callback();
                }
            });
            req.end();
        }, 2000);

        // If we were unable to connect after 10 seconds, stop trying.
        setTimeout(() => {
            clearInterval(connectionIntervalId);
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
                            this.startDaemonInTerminal();
                            break;
                        case 'Install DaCe':
                            vscode.commands.executeCommand('dace.installDace');
                            break;
                    }
                });

                if (failureCallback)
                    failureCallback();
            }
        }, 10000);
    }

    private sendRequest(url: string,
                        data?: any,
                        callback?: CallableFunction,
                        customErrorHandler?: CallableFunction,
                        startIfSleeping?: boolean): void {
        const doSend = () => {
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
                            // Check if this is all the data we're going to
                            // receive, or if the data is chunked up into
                            // pieces.
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
                            const errorDetails =
                                'DaCe request failed with code ' +
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
        };

        if (this.daemonRunning)
            doSend();
        else if (startIfSleeping)
            this.startDaemonInTerminal().then(() => {
                doSend();
            });
    }

    private sendGetRequest(url: string,
                           callback?: CallableFunction,
                           customErrorHandler?: CallableFunction,
                           startIfSleeping?: boolean): void {
        this.sendRequest(
            url, undefined, callback, customErrorHandler, startIfSleeping
        );
    }

    private sendPostRequest(url: string,
                            requestData: any,
                            callback?: CallableFunction,
                            customErrorHandler?: CallableFunction,
                            startIfSleeping?: boolean): void {
        this.sendRequest(
            url, requestData, callback, customErrorHandler, startIfSleeping
        );
    }

    public async promptStartDaemon(): Promise<void> {
        if (this.daemonBooting)
            return;

        // If the optimization panel isn't open, we don't want to interact
        // with the daemon. Don't prompt in that case.
        if (!OptimizationPanel.getInstance().isVisible())
            return;

        return new Promise((resolve, reject) => {
            vscode.window.showWarningMessage(
                'The DaCe daemon isn\'t running, so this action can\'t be ' +
                'performed. Do you want to start it?',
                'Yes',
                'No'
            ).then(opt => {
                switch (opt) {
                    case 'Yes':
                        DaCeInterface.getInstance().startDaemonInTerminal()
                            .then(() => {
                                resolve();
                            }).catch(() => {
                                reject();
                            });
                        break;
                    case 'No':
                        reject();
                        break;
                }
            });
        });
    }

    public start() {
        // The daemon shouldn't start if it's already booting due to being
        // started from some other source, or if the optimization panel isn't
        // visible.
        if (this.daemonRunning || this.daemonBooting ||
            !OptimizationPanel.getInstance().isVisible())
            return;

        const handleDaemonConnected = () => {
            SdfgViewerProvider.getInstance()?.onDaemonConnected();
            TransformationHistoryProvider.getInstance()?.refresh();
            TransformationListProvider.getInstance()?.refresh(true);
            this.querySdfgMetadata();
        };

        const onBooted = async () => {
            const customXformPaths = vscode.workspace.getConfiguration(
                'dace.optimization'
            )?.get<string[]>('customTransformationsPaths');
            if (customXformPaths) {
                const paths = [];
                for (const path of customXformPaths) {
                    try {
                        const u = vscode.Uri.file(path);
                        const stat = await vscode.workspace.fs.stat(u);
                        if (stat.type === vscode.FileType.Directory) {
                            for await (const fileUri of walkDirectory(u, '.py'))
                                paths.push(fileUri.fsPath);
                        } else if (stat.type === vscode.FileType.File) {
                            paths.push(u.fsPath);
                        }
                    } catch {
                        vscode.window.showErrorMessage(
                            'Failed to load custom transformations from ' +
                            'path "' + path + '" configured in your settings.'
                        );
                    }
                }

                this.sendPostRequest(
                    '/add_transformations',
                    {
                        paths: paths,
                    },
                    handleDaemonConnected
                );
            } else {
                handleDaemonConnected();
            }
        };

        const callBoot = () => {
            this.daemonBooting = true;

            this.startDaemonInTerminal().then(() => {
                onBooted();
            });
        };

        if (vscode.workspace.isTrusted) {
            callBoot();
        } else if (!this.daemonBooting) {
            this.daemonBooting = true;
            showUntrustedWorkspaceWarning('Running DaCe', callBoot);
        }
    }

    public previewSdfg(sdfg: any, history_mode: boolean = false) {
        DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'previewSdfg', [JSON.stringify(sdfg), history_mode]
        );
    }

    public exitPreview(refreshTransformations: boolean = false) {
        DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'previewSdfg', [undefined, false, refreshTransformations]
        );
    }

    public showSpinner(message?: string) {
        DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'setProcessingOverlay', [true, message ?? 'Processing, please wait']
        );
    }

    public hideSpinner() {
        DaCeVSCode.getInstance().getActiveEditor()?.invoke(
            'setProcessingOverlay', [false, '']
        );
    }

    private async sendApplyTransformationRequest(
        transformations: JsonTransformation[], callback: CallableFunction,
        processingMessage?: string
    ): Promise<void> {
        if (!this.daemonRunning)
            await this.promptStartDaemon();

        this.showSpinner(
            processingMessage ? processingMessage : (
                'Applying Transformation' + (
                    transformations.length > 1 ? 's' : ''
                )
            )
        );

        DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
            if (sdfg) {
                this.sendPostRequest(
                    '/apply_transformations',
                    {
                        sdfg: sdfg,
                        transformations: transformations,
                        permissive: false,
                    },
                    callback
                );
            }
        });
    }

    @ICPCRequest()
    public async expandLibraryNode(nodeid: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
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
                            resolve();
                        },
                        async (error: any): Promise<void> => {
                            this.genericErrorHandler(
                                error.message, error.details
                            );
                            this.hideSpinner();
                            reject(error.message);
                        },
                        true
                    );
                }
            });
        });
    }

    @ICPCRequest()
    public applyTransformations(transformations: JsonTransformation[]): void {
        this.sendApplyTransformationRequest(transformations, (data: any) => {
            this.hideSpinner();
            this.writeToActiveDocument(data.sdfg);
        });
    }

    @ICPCRequest()
    public previewTransformation(transformation: any): void {
        this.sendApplyTransformationRequest(
            [transformation],
            (data: any) => {
                this.previewSdfg(data.sdfg);
                this.hideSpinner();
            },
            'Generating Preview'
        );
    }

    /**
     * Given a transformation, export it to a JSON file.
     * This allows saving a transformation as matched to a specific subgraph or
     * pattern to a JSON file. This file can be loaded / deserialized through
     * DaCe's standard deserializer elsewhere, to obtain the same transformation
     * matched to the same subgraph, to be directly applied. This allows
     * transformations to be shared or used outside the interface in custom
     * scripts.
     * @param transformation Transformation to export, in JSON format.
     */
    @ICPCRequest()
    public exportTransformation(transformation: any): void {
        vscode.window.showSaveDialog({
            filters: {
                'JSON': ['json'],
            },
            title: 'Export Transformation',
        }).then(uri => {
            if (uri)
                vscode.workspace.fs.writeFile(
                    uri,
                    new TextEncoder().encode(JSON.stringify(transformation))
                ).then(
                    () => {
                        vscode.window.showInformationMessage(
                            'Successfully saved transformation to file.'
                        );
                    },
                    () => {
                        vscode.window.showErrorMessage(
                            'Failed to save transformation to file.'
                        );
                    }
                );
        });
    }

    @ICPCRequest()
    public writeToActiveDocument(json: any): void {
        const activeEditor = DaCeVSCode.getInstance().getActiveWebview();
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

    private gotoHistoryPoint(
        index: number | undefined, mode: InteractionMode
    ): void {
        const trafoHistProvider = TransformationHistoryProvider.getInstance();
        if (trafoHistProvider)
            trafoHistProvider.activeHistoryItemIndex = index;

        if (index === undefined) {
            if (mode === InteractionMode.PREVIEW)
                this.exitPreview(true);
            return;
        }

        DaCeVSCode.getInstance().getActiveSdfg().then(async (sdfg) => {
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
                    try {
                        await this.promptStartDaemon();
                    } catch {
                        return;
                    }
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

    public applyHistoryPoint(index?: number) {
        this.gotoHistoryPoint(index, InteractionMode.APPLY);
    }

    public previewHistoryPoint(index?: number) {
        this.gotoHistoryPoint(index, InteractionMode.PREVIEW);
    }

    @ICPCRequest()
    public async getFlops(): Promise<any> {
        return new Promise(async (resolve, reject) => {
            if (!this.daemonRunning) {
                try {
                    await this.promptStartDaemon();
                } catch (e) {
                    reject(e);
                    return;
                }
            }

            this.showSpinner('Calculating FLOP count');

            DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                if (!sdfg) {
                    const msg = 'No active SDFG editor!';
                    console.warn(msg);
                    reject(msg);
                    return;
                }

                this.sendPostRequest(
                    '/get_arith_ops',
                    {
                        'sdfg': sdfg,
                    },
                    (data: any) => {
                        resolve(data.arithOpsMap);
                        DaCeInterface.getInstance().hideSpinner();
                    },
                    (error: any) => {
                        this.genericErrorHandler(error.message, error.details);
                        reject(error.message);
                    }
                );
            });
        });
    }

    public compileSdfgFromFile(
        uri: vscode.Uri, callback: CallableFunction,
        suppressInstrumentation: boolean = false
    ): void {
        this.sendPostRequest(
            '/compile_sdfg_from_file',
            {
                'path': uri.fsPath,
                'suppress_instrumentation': suppressInstrumentation,
            },
            callback,
            undefined,
            true
        );
    }

    public async specializeGraph(
        uri: vscode.Uri, symbolMap?: { [symbol: string]: any | undefined }
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            this.showSpinner('Specializing');
            this.sendPostRequest(
                '/specialize_sdfg',
                {
                    'path': uri.fsPath,
                    'symbol_map': symbolMap,
                },
                (data: any) => {
                    this.hideSpinner();
                    this.writeToActiveDocument(data.sdfg);
                    resolve();
                },
                (error: any) => {
                    this.genericErrorHandler(error.message, error.details);
                    reject(error.message);
                }
            );
        });
    }

    public async querySdfgMetadata(): Promise<void> {
        async function callback(data: any) {
            SdfgViewerProvider.getInstance()?.setMetadata(data.metaDict);
        };

        if (this.daemonRunning)
            this.sendGetRequest(
                '/get_metadata',
                callback
            );
    }

    @ICPCRequest()
    public async loadTransformations(
        sdfg: any, selectedElements: any
    ): Promise<any[]> {
        await TransformationListProvider.getInstance()?.showLoading();

        return new Promise<any[]>(async (resolve, reject) => {
            if (!this.daemonRunning) {
                try {
                    await this.promptStartDaemon();
                } catch (e) {
                    reject(e);
                    return;
                }
            }

            this.sendPostRequest(
                '/transformations',
                {
                    sdfg: JSON.parse(sdfg),
                    selected_elements: JSON.parse(selectedElements),
                    permissive: false,
                },
                (data: any) => {
                    for (const elem of data.transformations) {
                        let docstring = '';
                        if (data.docstrings)
                            docstring = data.docstrings[
                                elem.transformation
                            ];
                        elem.docstring = docstring;
                    }

                    resolve(data.transformations);
                },
                (error: any) => {
                    this.genericErrorHandler(error.message, error.details);
                    reject(error.message);
                },
            );
        });
    }

    /**
     * Allow the user to load custom transformations from file(s).
     * This shows a file picker dialog, where the user can select one or many
     * files or folders. These files or folders are then checked for any '.py'
     * files, which are sent to the DaCe daemon to be loaded in as
     * transformations.
     */
    public async addCustomTransformations(
        fromDir: boolean = false
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: true,
                canSelectFolders: fromDir,
                filters: {
                    'Python': ['py'],
                },
                openLabel: 'Load',
                title: 'Load Custom Transformations',
            }).then(async (uri) => {
                if (uri) {
                    const paths = [];
                    for (const u of uri) {
                        const stat = await vscode.workspace.fs.stat(u);
                        if (stat.type === vscode.FileType.Directory) {
                            for await (const fileUri of walkDirectory(u, '.py'))
                                paths.push(fileUri.fsPath);
                        } else if (stat.type === vscode.FileType.File) {
                            paths.push(u.fsPath);
                        }
                    }

                    this.sendPostRequest(
                        '/add_transformations',
                        {
                            paths: paths,
                        },
                        (data: any) => {
                            // When done adding transformations, attempt a
                            // refresh.
                            if (data.done) {
                                resolve();
                                const editor =
                                    DaCeVSCode.getInstance().getActiveEditor();
                                editor?.invoke('refreshTransformationList');
                            }
                        },
                        (error: any) => {
                            reject(error.message);
                        }
                    );
                } else {
                    reject();
                }
            });
        });
    }

    public isRunning(): boolean {
        return this.daemonRunning;
    }

}
