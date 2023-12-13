// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { JsonSDFG } from '@spcl/sdfv/src';
import { request } from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ICPCRequest } from '../common/messaging/icpc_messaging_component';

import { DaCeVSCode } from '../dace_vscode';
import {
    showUntrustedWorkspaceWarning,
    walkDirectory
} from '../utils/utils';
import {
    JsonTransformation
} from '../webclients/components/transformations/transformations';
import { BaseComponent } from './base_component';
import { ComponentTarget } from './components';
import { OptimizationPanel } from './optimization_panel';
import {
    TransformationListProvider
} from './transformation_list';

enum InteractionMode {
    PREVIEW,
    APPLY,
}

export class DaCeInterface
extends BaseComponent
implements vscode.WebviewViewProvider {

    private static readonly viewType: string = ComponentTarget.DaCe;

    private view?: vscode.WebviewView;

    private static INSTANCE?: DaCeInterface;

    public static getInstance(): DaCeInterface | undefined {
        return this.INSTANCE;
    }

    public static register(ctx: vscode.ExtensionContext): vscode.Disposable {
        DaCeInterface.INSTANCE = new DaCeInterface(ctx, this.viewType);
        const options: vscode.WebviewPanelOptions = {
            retainContextWhenHidden: false,
        };
        return vscode.window.registerWebviewViewProvider(
            DaCeInterface.viewType,
            DaCeInterface.INSTANCE,
            {
                webviewOptions: options,
            }
        );
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

    @ICPCRequest()
    public async setPort(port: number): Promise<void> {
        this.port = port;
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

        const fallbackCommand = 'python';

        try {
            let pyExt = vscode.extensions.getExtension('ms-python.python');
            if (!pyExt) {
                vscode.window.showWarningMessage(
                    `Could not find the Python extension to run the ` +
                    `DaCe backend, falling back to the regular 'python' ` +
                    `command. If you have DaCe installed in a virtual ` +
                    `environment, installing the Python extension is highly ` +
                    `recommended.`
                );
                return fallbackCommand;
            }

            if (!pyExt.isActive)
                await pyExt.activate();

            const environmentsAPI = pyExt.exports.environments;
            const envPath = environmentsAPI.getActiveEnvironmentPath();
            const pyEnv = await environmentsAPI.resolveEnvironment(envPath);
            // Conda environment activation can take long, which is why we want
            // to instead use conda run if the active environment is a Conda
            // environment.
            if (pyEnv && pyEnv.environment.type === 'Conda')
                return `conda run -n ${pyEnv.environment.name} ` +
                    `--no-capture-output python`;

            const pyCmd = pyExt.exports.settings.getExecutionDetails ?
                pyExt.exports.settings.getExecutionDetails(
                    uri
                ).execCommand :
                pyExt.exports.settings.getExecutionCommand(uri);
            // Ensure spaces in the python command don't trip up the
            // terminal.
            if (pyCmd)
                return this.cleanCmd(pyCmd, spaceSafe);
        } catch (_) {
            return fallbackCommand;
        }
        return fallbackCommand;
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

    @ICPCRequest()
    public async quitDaemon(): Promise<void> {
        this.daemonTerminal?.dispose();
        this.daemonTerminal = undefined;
        this.daemonBooting = false;
        this.daemonRunning = false;
        this.invoke('setStatus', [false]);
    }

    @ICPCRequest()
    public async startDaemonInTerminal(port?: number): Promise<void> {
        if (!port) {
            // If no explicit port override was provided, try to see if a pre-
            // configured port exists in the settings.
            const overridePort = vscode.workspace.getConfiguration(
                'dace.backend'
            )?.port;
            if (overridePort > 0)
                port = overridePort;
        }

        return new Promise((resolve, reject) => {
            if (this.daemonTerminal === undefined)
                this.daemonTerminal = vscode.window.createTerminal({
                    hideFromUser: false,
                    name: 'DaCe Backend',
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
                    if (port) {
                        this.port = port;
                        this.daemonTerminal?.sendText(
                            pyCmd + ' ' + scriptUri.fsPath + ' -p ' +
                            port.toString()
                        );
                        this.pollDaemon(resolve, reject);
                    } else {
                        this.getRandomPort().then(port => {
                            this.invoke('setPort', [port]);
                            this.daemonTerminal?.sendText(
                                pyCmd + ' ' + scriptUri.fsPath + ' -p ' +
                                port.toString()
                            );
                            this.pollDaemon(resolve, reject);
                        });
                    }
                });
            } else {
                this.daemonBooting = false;
            }
        });
    }

    @ICPCRequest()
    private pollDaemon(
        callback?: CallableFunction, failureCallback?: CallableFunction
    ): void {
        // We poll the daemon every second to see if it's awake.
        const connectionIntervalId = setInterval(() => {
            console.log('Checking for daemon');
            const req = request({
                host: '::1',
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
                    this.invoke('setStatus', [true]);

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
                    'Unable to start and connect to DaCe. Do you want to ' +
                    'retry or open the troubleshooting guide?',
                    'Retry',
                    'Troubleshooting'
                ).then(opt => {
                    switch (opt) {
                        case 'Retry':
                            this.startDaemonInTerminal();
                            break;
                        case 'Troubleshooting':
                            vscode.env.openExternal(vscode.Uri.parse(
                                'https://spcldace.readthedocs.io/en/latest' +
                                '/setup/installation.html#common-issues-with' +
                                '-the-visual-studio-code-extension'
                            ));
                            break;
                    }
                });

                if (failureCallback)
                    failureCallback();
            }
        }, 20000);
    }

    private sendDaCeRequest(url: string,
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
                host: '::1',
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
                                            ?.genericErrorHandler(
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
                                DaCeInterface.getInstance()
                                    ?.genericErrorHandler(
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
        this.sendDaCeRequest(
            url, undefined, callback, customErrorHandler, startIfSleeping
        );
    }

    private sendPostRequest(url: string,
                            requestData: any,
                            callback?: CallableFunction,
                            customErrorHandler?: CallableFunction,
                            startIfSleeping?: boolean): void {
        this.sendDaCeRequest(
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
                        DaCeInterface.getInstance()?.startDaemonInTerminal()
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

    private onPostInit(): void {
        Promise.all([
            DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
                'setDaemonConnected', [true]
            ),
            DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
                'resyncTransformations', [true]
            ),
            DaCeInterface.getInstance()?.querySdfgMetadata().then((meta) => {
                DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
                    'setMetaDict', [meta]
                );
            })
        ]);
    }

    private async onDeamonConnected(): Promise<void> {
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
                () => {
                    this.onPostInit();
                }
            );
        } else {
            this.onPostInit();
        }
    }

    @ICPCRequest(true)
    public start(port?: number) {
        // The daemon shouldn't start if it's already booting due to being
        // started from some other source, or if the optimization panel isn't
        // visible.
        if (this.daemonRunning || this.daemonBooting ||
            !OptimizationPanel.getInstance().isVisible())
            return;

        const callBoot = () => {
            this.daemonBooting = true;

            this.startDaemonInTerminal(port).then(() => {
                this.onDeamonConnected();
            });
        };

        if (vscode.workspace.isTrusted) {
            callBoot();
        } else if (!this.daemonBooting) {
            this.daemonBooting = true;
            showUntrustedWorkspaceWarning('Running DaCe', callBoot);
        }
    }

    public previewSdfg(
        sdfg: any, history_index: number | undefined = undefined
    ): void {
        DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
            'previewSdfg', [JSON.stringify(sdfg), history_index]
        );
    }

    public exitPreview(refreshTransformations: boolean = false): void {
        DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
            'previewSdfg', [undefined, undefined, refreshTransformations]
        );
    }

    public showSpinner(message?: string): void {
        DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
            'setProcessingOverlay', [true, message ?? 'Processing, please wait']
        );
    }

    public hideSpinner(): void {
        DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
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
                            this.writeToActiveDocument(data.sdfg).then(() => {
                                this.hideSpinner();
                                resolve();
                            });
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
    public async applyTransformations(
        transformations: JsonTransformation[]
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sendApplyTransformationRequest(
                transformations, (data: any) => {
                    this.writeToActiveDocument(data.sdfg).then(() => {
                        this.hideSpinner();
                        resolve();
                    }).catch(() => {
                        reject();
                    });
                }
            );
        });
    }

    @ICPCRequest()
    public async previewTransformation(transformation: any): Promise<void> {
        return new Promise((resolve) => {
            this.sendApplyTransformationRequest(
                [transformation],
                (data: any) => {
                    this.previewSdfg(data.sdfg);
                    this.hideSpinner();
                    resolve();
                },
                'Generating Preview'
            );
        });
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
    public async writeToActiveDocument(json: JsonSDFG | string): Promise<void> {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor) {
            if (typeof json === 'string')
                activeEditor.handleLocalEdit(json);
            else
                activeEditor.handleLocalEdit(JSON.stringify(json, null, 1));
        }
    }

    private gotoHistoryPoint(
        index: number | undefined | null, mode: InteractionMode
    ): void {
        if (index === undefined || index === null) {
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
                            this.previewSdfg(originalSdfg, index);
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
                            daceInterface?.writeToActiveDocument(data.sdfg).then(
                                () => daceInterface?.hideSpinner()
                            );
                        };
                        break;
                    case InteractionMode.PREVIEW:
                    default:
                        callback = function (data: any) {
                            const daceInterface = DaCeInterface.getInstance();
                            daceInterface?.previewSdfg(data.sdfg, index);
                            daceInterface?.hideSpinner();
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

    @ICPCRequest()
    public applyHistoryPoint(index?: number) {
        this.gotoHistoryPoint(index, InteractionMode.APPLY);
    }

    @ICPCRequest()
    public previewHistoryPoint(index?: number | null) {
        this.gotoHistoryPoint(index, InteractionMode.PREVIEW);
    }

    private showAssumptionsInputBox(): Thenable<string | undefined> {
        return vscode.window.showInputBox({
            placeHolder: 'e.g. N>5 N<M M==STEPS STEPS==100',
            prompt: 'State assumptions for symbols separated by space.',
            title: 'Assumptions for symbols'
        });
    }

    private showCacheParamsInputBox(): Thenable<string | undefined> {
        return vscode.window.showInputBox({
            placeHolder: 'e.g. 1024 64',
            prompt: 'State cache size C and cache line size L in bytes separated by a space.',
            title: 'Cache Parameters'
        });
    }

    private checkAssumptionsInput(input: string | undefined): readonly [string,boolean] {
        if (input === undefined){
            input = "";
        }
        if (!(/^(([A-z][A-z|0-9]*(==|>|<)[A-z|0-9]+ )*([A-z][A-z|0-9]*(==|>|<)[A-z|0-9]+))?$/.test(input))){
            vscode.window.showErrorMessage(`Wrong formatting when entering assumptions. Individual assumptions
                are separated by spaces. An assumption consists of <LHS><operator><RHS>, where <LHS> is a
                symbol name, <operator> is in {==, <, >} and <RHS> is another symbol name or a number.`);
            return [input, false] as const;
        }
        return [input, true] as const;
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

                this.showAssumptionsInputBox().then((value) => {
                    const [assumptions, valid] = this.checkAssumptionsInput(value);
                    if(valid){
                        this.sendPostRequest(
                            '/get_arith_ops',
                            {
                                'sdfg': sdfg,
                                'assumptions': assumptions,
                            },
                            (data: any) => {
                                resolve(data.arithOpsMap);
                                DaCeInterface.getInstance()?.hideSpinner();
                            },
                            (error: any) => {
                                this.genericErrorHandler(error.message, error.details);
                                reject(error.message);
                            }
                        );
                    } else {
                        DaCeInterface.getInstance()?.hideSpinner();
                    }
                });
            });
        });
    }

    @ICPCRequest()
    public async getDepth(): Promise<any> {
        return new Promise(async (resolve, reject) => {
            if (!this.daemonRunning) {
                try {
                    await this.promptStartDaemon();
                } catch (e) {
                    reject(e);
                    return;
                }
            }

            this.showSpinner('Calculating Depth');

            DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                if (!sdfg) {
                    const msg = 'No active SDFG editor!';
                    console.warn(msg);
                    reject(msg);
                    return;
                }

                this.showAssumptionsInputBox().then((value) => {
                    const [assumptions, valid] = this.checkAssumptionsInput(value);
                    if(valid){
                        this.sendPostRequest(
                            '/get_depth',
                            {
                                'sdfg': sdfg,
                                'assumptions': assumptions,
                            },
                            (data: any) => {
                                resolve(data.depthMap);
                                DaCeInterface.getInstance()?.hideSpinner();
                            },
                            (error: any) => {
                                this.genericErrorHandler(error.message, error.details);
                                reject(error.message);
                            }
                        );
                    } else {
                        DaCeInterface.getInstance()?.hideSpinner();
                    }
                });
            });
        });
    }

    @ICPCRequest()
    public async getAvgParallelism(): Promise<any> {
        return new Promise(async (resolve, reject) => {
            if (!this.daemonRunning) {
                try {
                    await this.promptStartDaemon();
                } catch (e) {
                    reject(e);
                    return;
                }
            }

            this.showSpinner('Calculating Average Parallelism');

            DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                if (!sdfg) {
                    const msg = 'No active SDFG editor!';
                    console.warn(msg);
                    reject(msg);
                    return;
                }


                this.showAssumptionsInputBox().then((value) => {
                    const [assumptions, valid] = this.checkAssumptionsInput(value);
                    if(valid){
                        this.sendPostRequest(
                            '/get_avg_parallelism',
                            {
                                'sdfg': sdfg,
                                'assumptions': assumptions,
                            },
                            (data: any) => {
                                resolve(data.avgParallelismMap);
                                DaCeInterface.getInstance()?.hideSpinner();
                            },
                            (error: any) => {
                                this.genericErrorHandler(error.message, error.details);
                                reject(error.message);
                            }
                        );
                    } else {
                        DaCeInterface.getInstance()?.hideSpinner();
                    }
                });
            });
        });
    }

    @ICPCRequest()
    public async getOperationalIntensity(): Promise<any> {
        return new Promise(async (resolve, reject) => {
            if (!this.daemonRunning) {
                try {
                    await this.promptStartDaemon();
                } catch (e) {
                    reject(e);
                    return;
                }
            }

            this.showSpinner('Calculating Operational Intensity');

            DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                if (!sdfg) {
                    const msg = 'No active SDFG editor!';
                    console.warn(msg);
                    reject(msg);
                    return;
                }

                this.showAssumptionsInputBox().then((value) => {
                    const [assumptions, valid] = this.checkAssumptionsInput(value);
                    if(valid){
                        this.showCacheParamsInputBox().then((cacheParams) => {
                            if(cacheParams === '' || cacheParams === undefined)
                                cacheParams = '1024 64';
                            this.sendPostRequest(
                                '/get_operational_intensity',
                                {
                                    'sdfg': sdfg,
                                    'cacheParams': cacheParams,
                                    'assumptions': assumptions,
                                },
                                (data: any) => {
                                    resolve(data.opInMap);
                                    DaCeInterface.getInstance()?.hideSpinner();
                                },
                                (error: any) => {
                                    this.genericErrorHandler(error.message, error.details);
                                    reject(error.message);
                                }
                            );
                        });
                    } else {
                        DaCeInterface.getInstance()?.hideSpinner();
                    }
                });
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

    @ICPCRequest()
    public async specializeGraph(
        sdfg: string, symbolMap?: { [symbol: string]: any | undefined }
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            this.showSpinner('Specializing');
            this.sendPostRequest(
                '/specialize_sdfg',
                {
                    'sdfg': sdfg,
                    'symbol_map': symbolMap,
                },
                (data: any) => {
                    this.hideSpinner();
                    resolve(data.sdfg);
                },
                (error: any) => {
                    this.genericErrorHandler(error.message, error.details);
                    reject(error.message);
                }
            );
        });
    }

    @ICPCRequest()
    public async querySdfgMetadata(): Promise<Record<string, any>> {
        return new Promise<any>((resolve, reject) => {
            if (this.daemonRunning)
                this.sendGetRequest(
                    '/get_metadata',
                    (data: any) => {
                        resolve(data.metaDict);
                    }
                );
            else
                reject();
        });
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
                    selected_elements: selectedElements,
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
                                    DaCeVSCode.getInstance().activeSDFGEditor;
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

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken): void | Thenable<void> {
        // If the DaCe interface has not been started yet, start it here.
        DaCeInterface.getInstance()?.start();

        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'media'
                )),
                vscode.Uri.file(path.join(
                    this.context.extensionPath, 'dist', 'web'
                )),
            ],
        };

        const fpBaseHtml: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath,
            'media',
            'components',
            'dace',
            'index.html'
        ));
        const fpMediaFolder: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath, 'media'
        ));
        const fpScriptFolder: vscode.Uri = vscode.Uri.file(path.join(
            this.context.extensionPath, 'dist', 'web'
        ));
        vscode.workspace.fs.readFile(fpBaseHtml).then((data) => {
            let baseHtml = data.toString();
            baseHtml = baseHtml.replace(
                this.csrSrcIdentifier,
                webviewView.webview.asWebviewUri(fpMediaFolder).toString()
            );
            baseHtml = baseHtml.replace(
                this.scriptSrcIdentifier,
                webviewView.webview.asWebviewUri(fpScriptFolder).toString()
            );
            webviewView.webview.html = baseHtml;

            this.setTarget(webviewView.webview);
        });
    }

    public show() {
        this.view?.show();
    }

    public isVisible(): boolean {
        if (this.view === undefined)
            return false;
        return this.view.visible;
    }

    @ICPCRequest(true)
    public onReady(): Promise<void> {
        if (this.port)
            this.invoke('setPort', [this.port]);
        if (this.daemonRunning)
            this.invoke('setStatus', [this.daemonRunning]);
        return super.onReady();
    }

}
