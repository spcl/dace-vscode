// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { PythonExtension } from '@vscode/python-extension';
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
    walkDirectory,
} from '../utils/utils';
import {
    JsonTransformation,
} from '../webclients/components/transformations/transformations';
import { BaseComponent } from './base_component';
import { ComponentTarget } from './components';
import { OptimizationPanel } from './optimization_panel';
import {
    TransformationListProvider,
} from './transformation_list';
import * as semver from 'semver';
import { MetaDictT } from '../types';


export interface DaCeException {
    message: string;
    details?: string;
}

export type DaCeMessage = Record<string, any> & {
    error?: DaCeException;
};

enum InteractionMode {
    PREVIEW,
    APPLY,
}

const MIN_SAFE_VERSION = '0.16.0';
const MAX_SAFE_VERSION = '1.0.2';

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

    private version: string = '';
    private versionOk: boolean = false;
    private additionalVersionInfo: string = '';

    private async getRandomPort(): Promise<number> {
        return new Promise((resolve, reject) => {
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
                this.getRandomPort().then((port) => {
                    resolve(port);
                }).catch((err: unknown) => {
                    console.error(err);
                    reject(new Error('Failed to get random port'));
                });
            });
        });
    }

    @ICPCRequest()
    public setPort(port: number): void {
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
        if (spaceSafe) {
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
        }
        return cmds.join(' ');
    }

    public async getPythonExecCommand(
        uri: vscode.Uri | undefined,
        spaceSafe = true
    ): Promise<string> {
        const overridePath = vscode.workspace.getConfiguration(
            'dace.backend'
        ).interpreterPath as string | undefined;
        if (overridePath && overridePath !== '')
            return this.cleanCmd([overridePath], spaceSafe);

        const fallbackCommand = 'python';

        try {
            const pythonApi = await PythonExtension.api();
            const environmentsAPI = pythonApi.environments;

            // Get the active environment path.
            const envPath = environmentsAPI.getActiveEnvironmentPath();
            const pyEnv = await environmentsAPI.resolveEnvironment(envPath);
            const environment = pyEnv?.environment;

            // Conda environment activation can take long, which is why we want
            // to instead use conda run if the active environment is a Conda
            // environment.
            if (environment?.type === 'Conda' && environment.name) {
                return `conda run -n ${environment.name} ` +
                    '--no-capture-output python';
            }

            // Ensure spaces in the python command don't trip up the
            // terminal.
            return this.cleanCmd(
                [pyEnv?.executable.uri?.fsPath ?? fallbackCommand],
                spaceSafe
            );
        } catch (_) {
            return fallbackCommand;
        }
    }

    public async genericErrorHandler(
        message: string, details?: any
    ): Promise<void> {
        await this.hideSpinner();
        console.error(message);
        let text = message;
        if (details) {
            console.error(details);
            text += ' (' + String(details) + ')';
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
    public async quitDaemon(): Promise<unknown> {
        this.daemonTerminal?.dispose();
        this.daemonTerminal = undefined;
        this.daemonBooting = false;
        this.daemonRunning = false;
        return this.invoke('setStatus', [false]);
    }

    @ICPCRequest()
    public async startDaemonInTerminal(port?: number): Promise<void> {
        if (!port) {
            // If no explicit port override was provided, try to see if a pre-
            // configured port exists in the settings.
            const overridePort = vscode.workspace.getConfiguration(
                'dace.backend'
            ).port as number | undefined;
            if (overridePort !== undefined && overridePort > 0)
                port = overridePort;
        }

        return new Promise((resolve, reject) => {
            this.daemonTerminal ??= vscode.window.createTerminal({
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
                            void this.invoke('setPort', [port]);
                            this.daemonTerminal?.sendText(
                                pyCmd + ' ' + scriptUri.fsPath + ' -p ' +
                                port.toString()
                            );
                            this.pollDaemon(resolve, reject);
                        }).catch(() => {
                            reject(new Error('Failed to get random port'));
                        });
                    }
                }).catch(() => {
                    reject(new Error('Failed to get Python command'));
                });
            } else {
                this.daemonBooting = false;
            }
        });
    }

    @ICPCRequest()
    private pollDaemon(
        callback?: () => unknown, failureCallback?: () => unknown
    ): void {
        // We poll the daemon every second to see if it's awake.
        const connectionIntervalId = setInterval(() => {
            console.log('Checking for daemon');
            const req = request({
                host: '::1',
                port: this.port,
                path: '/version',
                method: 'GET',
                timeout: 1000,
            }, response => {
                response.setEncoding('utf8');
                response.on('data', (data?: string) => {
                    if (response.statusCode === 200 && data) {
                        this.version = data;

                        console.debug('Daemon running');
                        console.debug(this.version);

                        vscode.window.setStatusBarMessage(
                            'Connected to a DaCe daemon', 10000
                        );
                        this.daemonRunning = true;
                        this.daemonBooting = false;
                        clearInterval(connectionIntervalId);
                        void this.invoke('setStatus', [true]);

                        this.versionOk = semver.satisfies(
                            this.version,
                            MIN_SAFE_VERSION + ' - ' + MAX_SAFE_VERSION
                        );
                        const below = semver.lt(this.version, MIN_SAFE_VERSION);
                        const problemText = this.versionOk ? '' : (
                            below ? 'below the minimum' : 'above the maximum'
                        );
                        const problemVersion = this.versionOk ? '' : (
                            below ?  MIN_SAFE_VERSION : MAX_SAFE_VERSION
                        );
                        this.additionalVersionInfo = this.versionOk ? '' : (
                            'Your DaCe version (' + this.version + ') is ' +
                            problemText + ' supported ' + 'version (' +
                            problemVersion + ') for the current version of ' +
                            'the extension.'
                        ) + ' Compatibility is given on a best-effort basis.' +
                        ' Certain features may not work as expected.';
                        void this.invoke(
                            'setVersion',
                            [
                                this.version,
                                this.versionOk,
                                this.additionalVersionInfo,
                            ]
                        );

                        if (!this.versionOk) {
                            vscode.window.showWarningMessage(
                                this.additionalVersionInfo
                            );
                        }

                        // If a callback was provided, continue execution there.
                        if (callback)
                            callback();
                    }
                });
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
                            this.startDaemonInTerminal().catch(() => {
                                console.error('Failed to start DaCe daemon');
                            });
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

    private sendDaCeRequest(
        url: string,
        data?: any,
        callback?: (msg: DaCeMessage) => unknown,
        customErrorHandler?: (err: DaCeException) => unknown,
        startIfSleeping?: boolean
    ): void {
        const doSend = () => {
            let method = 'GET';
            let postData = undefined;
            if (data !== undefined)
                method = 'POST';

            const parameters = {
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
                    response.on('data', (recvData: string) => {
                        const dace = DaCeInterface.getInstance();
                        if (response.statusCode === 200) {
                            accumulatedData += recvData;
                            // Check if this is all the data we're going to
                            // receive, or if the data is chunked up into
                            // pieces.
                            const contentLength =
                                Number(response.headers['content-length']);
                            if (!contentLength ||
                                accumulatedData.length >= contentLength) {
                                let error: DaCeException | undefined =
                                    undefined;
                                let parsed: DaCeMessage | undefined = undefined;
                                try {
                                    parsed = JSON.parse(
                                        accumulatedData
                                    ) as DaCeMessage;
                                    if (parsed.error) {
                                        error = parsed.error;
                                        parsed = undefined;
                                    }
                                } catch (e: unknown) {
                                    error = {
                                        message: 'Failed to parse response',
                                        details: String(e),
                                    };
                                }

                                if (parsed) {
                                    callback(parsed);
                                } else if (error) {
                                    if (customErrorHandler) {
                                        customErrorHandler(error);
                                    } else {
                                        dace?.genericErrorHandler(
                                            error.message, error.details
                                        ).catch((err: unknown) => {
                                            console.error(err);
                                        });
                                    }
                                }
                            }
                        } else {
                            const errorMessage =
                                'An internal DaCe error was encountered!';
                            const errorDetails =
                                'DaCe request failed with code ' + (
                                    response.statusCode?.toString() ?? 'unknown'
                                );
                            if (customErrorHandler) {
                                customErrorHandler({
                                    message: errorMessage,
                                    details: errorDetails,
                                });
                            } else {
                                dace?.genericErrorHandler(
                                    errorMessage, errorDetails
                                ).catch((err: unknown) => {
                                    console.error(err);
                                });
                            }
                        }
                    });
                }
            });
            if (postData !== undefined)
                req.write(postData);
            req.end();
        };

        if (this.daemonRunning) {
            doSend();
        } else if (startIfSleeping) {
            this.startDaemonInTerminal().then(() => {
                doSend();
            }).catch(() => {
                console.error('Failed to start DaCe daemon');
            });
        }
    }

    private sendGetRequest(
        url: string,
        callback?: (msg: DaCeMessage) => unknown,
        customErrorHandler?: (msg: DaCeException) => unknown,
        startIfSleeping?: boolean
    ): void {
        this.sendDaCeRequest(
            url, undefined, callback, customErrorHandler, startIfSleeping
        );
    }

    private sendPostRequest(
        url: string,
        requestData: any,
        callback?: (msg: DaCeMessage) => unknown,
        customErrorHandler?: (msg: DaCeException) => unknown,
        startIfSleeping?: boolean
    ): void {
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
                            }).catch((err: unknown) => {
                                if (err instanceof Error)
                                    reject(err);
                                else
                                    reject(new Error(String(err)));
                            });
                        break;
                    case 'No':
                        reject(new Error('User declined to start daemon'));
                        break;
                }
            });
        });
    }

    private async onPostInit(): Promise<void> {
        await Promise.all([
            DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
                'setDaemonConnected', [true]
            ),
            DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
                'resyncTransformations', [true]
            ),
            DaCeInterface.getInstance()?.querySdfgMetadata().then(
                async (meta) => {
                    await DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
                        'setMetaDict', [meta]
                    );
                }
            ),
        ]);
    }

    private async onDeamonConnected(): Promise<void> {
        const customXformPaths = vscode.workspace.getConfiguration(
            'dace.optimization'
        ).get<string[]>('customTransformationsPaths');
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
                async () => {
                    await this.onPostInit();
                }
            );
        } else {
            await this.onPostInit();
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

            this.startDaemonInTerminal(port).then(async () => {
                await this.onDeamonConnected();
            }).catch(() => {
                console.error('Failed to start DaCe daemon');
            });
        };

        if (vscode.workspace.isTrusted) {
            callBoot();
        } else {
            this.daemonBooting = true;
            showUntrustedWorkspaceWarning('Running DaCe', callBoot);
        }
    }

    public async previewSdfg(
        sdfg: JsonSDFG, historyIndex?: number
    ): Promise<unknown> {
        return DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
            'previewSdfg', [JSON.stringify(sdfg), historyIndex]
        );
    }

    public async exitPreview(
        refreshTransformations: boolean = false
    ): Promise<unknown> {
        return DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
            'previewSdfg', [undefined, undefined, refreshTransformations]
        );
    }

    public async showSpinner(message?: string): Promise<unknown> {
        return DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
            'setProcessingOverlay', [true, message ?? 'Processing, please wait']
        );
    }

    public async hideSpinner(): Promise<unknown> {
        return DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
            'setProcessingOverlay', [false, '']
        );
    }

    private async sendApplyTransformationRequest(
        transformations: JsonTransformation[],
        callback: (data: DaCeMessage) => unknown,
        processingMessage?: string
    ): Promise<void> {
        if (!this.daemonRunning)
            await this.promptStartDaemon();

        void this.showSpinner(
            processingMessage ?? 'Applying Transformation' + (
                transformations.length > 1 ? 's' : ''
            )
        );

        await DaCeVSCode.getInstance().getActiveSdfg().then(
            (sdfg?: JsonSDFG) => {
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
            }
        );
    }

    @ICPCRequest()
    public async expandLibraryNode(nodeid: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            DaCeVSCode.getInstance().getActiveSdfg().then(async (sdfg) => {
                if (sdfg) {
                    await this.showSpinner('Expanding library node');
                    this.sendPostRequest(
                        '/expand_library_node',
                        {
                            sdfg: sdfg,
                            nodeid: nodeid,
                        },
                        async (data: DaCeMessage) => {
                            await this.writeToActiveDocument(
                                data.sdfg as string | JsonSDFG
                            ).then(() => {
                                void this.hideSpinner();
                                resolve();
                            });
                        },
                        async (error: DaCeException): Promise<void> => {
                            await this.genericErrorHandler(
                                error.message, error.details
                            );
                            void this.hideSpinner();
                            reject(new Error(error.message));
                        },
                        true
                    );
                }
            }).catch((reason: unknown) => {
                if (reason instanceof Error)
                    reject(reason);
                else
                    reject(new Error(String(reason)));
            });
        });
    }

    @ICPCRequest()
    public async applyTransformations(
        transformations: JsonTransformation[]
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sendApplyTransformationRequest(
                transformations, (data: DaCeMessage) => {
                    this.writeToActiveDocument(
                        data.sdfg as string | JsonSDFG
                    ).then(() => {
                        void this.hideSpinner();
                        resolve();
                    }).catch((err: unknown) => {
                        if (err instanceof Error)
                            reject(err);
                        else
                            reject(new Error(String(err)));
                    });
                }
            ).catch((err: unknown) => {
                console.error(err);
            });
        });
    }

    @ICPCRequest()
    public async previewTransformation(
        transformation: JsonTransformation
    ): Promise<void> {
        return new Promise((resolve) => {
            this.sendApplyTransformationRequest(
                [transformation],
                async (data: DaCeMessage) => {
                    await this.previewSdfg(data.sdfg as JsonSDFG);
                    void this.hideSpinner();
                    resolve();
                },
                'Generating Preview'
            ).catch((err: unknown) => {
                console.error(err);
            });
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
            if (uri) {
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
            }
        });
    }

    @ICPCRequest()
    public async writeToActiveDocument(json: JsonSDFG | string): Promise<void> {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor) {
            if (typeof json === 'string') {
                await activeEditor.handleLocalEdit(json);
            } else {
                await activeEditor.handleLocalEdit(
                    JSON.stringify(json, null, 1)
                );
            }
        }
    }

    private async gotoHistoryPoint(
        index: number | undefined | null, mode: InteractionMode
    ): Promise<void> {
        if (index === undefined || index === null) {
            if (mode === InteractionMode.PREVIEW)
                await this.exitPreview(true);
            return;
        }

        const sdfg = await DaCeVSCode.getInstance().getActiveSdfg();
        if (!sdfg)
            return;

        if (index < 0) {
            // This item refers to the original SDFG, so we revert to that.
            const origSdfg = sdfg.attributes?.orig_sdfg as JsonSDFG | undefined;
            if (origSdfg) {
                switch (mode) {
                    case InteractionMode.APPLY:
                        await this.writeToActiveDocument(origSdfg);
                        break;
                    case InteractionMode.PREVIEW:
                    default:
                        await this.previewSdfg(origSdfg, index);
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

            await this.showSpinner('Loading SDFG');
            let callback: (data: DaCeMessage) => unknown;
            switch (mode) {
                case InteractionMode.APPLY:
                    callback = async (data: DaCeMessage) => {
                        const dace = DaCeInterface.getInstance();
                        await dace?.writeToActiveDocument(
                            data.sdfg as JsonSDFG
                        ).then(
                            () => dace.hideSpinner()
                        );
                    };
                    break;
                case InteractionMode.PREVIEW:
                default:
                    callback = async (data: DaCeMessage) => {
                        const dace = DaCeInterface.getInstance();
                        await dace?.previewSdfg(data.sdfg as JsonSDFG, index);
                        await dace?.hideSpinner();
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
    }

    @ICPCRequest()
    public async applyHistoryPoint(index?: number): Promise<unknown> {
        return this.gotoHistoryPoint(index, InteractionMode.APPLY);
    }

    @ICPCRequest()
    public async previewHistoryPoint(index?: number | null): Promise<unknown> {
        return this.gotoHistoryPoint(index, InteractionMode.PREVIEW);
    }

    private showAssumptionsInputBox(): Thenable<string | undefined> {
        return vscode.window.showInputBox({
            placeHolder: 'e.g. N>5 N<M M==STEPS STEPS==100',
            prompt: 'State assumptions for symbols separated by space.',
            title: 'Assumptions for symbols',
        });
    }

    private showCacheParamsInputBox(): Thenable<string | undefined> {
        return vscode.window.showInputBox({
            placeHolder: 'e.g. 1024 64',
            prompt: 'State cache size C and cache line size L in bytes ' +
                'separated by a space.',
            title: 'Cache Parameters',
        });
    }

    private checkAssumptionsInput(input?: string): readonly [string, boolean] {
        input ??= '';
        const singleAssumption = /[A-z][A-z|0-9]*(==|>|<)[A-z|0-9]+/;
        const assumptionRegex = new RegExp((
            '^((' + singleAssumption.source + ' ' +
            ')*(' + singleAssumption.source + '))?$'
        ));
        if (!assumptionRegex.test(input)) {
            vscode.window.showErrorMessage(
                'Wrong formatting when entering assumptions. ' +
                'Individual assumptions are separated by spaces. ' +
                'An assumption consists of <LHS><operator><RHS>, where ' +
                '<LHS> is a symbol name, <operator> is in {==, <, >} and ' +
                '<RHS> is another symbol name or a number.'
            );
            return [input, false] as const;
        }
        return [input, true] as const;
    }


    @ICPCRequest()
    public async getFlops(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.showSpinner('Calculating FLOP count').then(() => {
                DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                    if (!sdfg) {
                        const msg = 'No active SDFG editor!';
                        console.warn(msg);
                        reject(new Error(msg));
                        return;
                    }

                    this.showAssumptionsInputBox().then((value) => {
                        const [assumptions, valid] = this.checkAssumptionsInput(
                            value
                        );
                        if(valid) {
                            this.sendPostRequest(
                                '/get_arith_ops',
                                {
                                    'sdfg': sdfg,
                                    'assumptions': assumptions,
                                },
                                (data: DaCeMessage) => {
                                    void DaCeInterface.getInstance(
                                    )?.hideSpinner();
                                    resolve(data.arithOpsMap);
                                },
                                async (error: DaCeException) => {
                                    await this.genericErrorHandler(
                                        error.message, error.details
                                    );
                                    reject(new Error(error.message));
                                }
                            );
                        } else {
                            void DaCeInterface.getInstance()?.hideSpinner();
                        }
                    });
                }).catch((reason: unknown) => {
                    if (reason instanceof Error)
                        reject(reason);
                    else
                        reject(new Error(String(reason)));
                });
            }).catch((err: unknown) => {
                console.error(err);
            });
        });
    }

    @ICPCRequest()
    public async getDepth(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.showSpinner('Calculating Depth').then(() => {
                DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                    if (!sdfg) {
                        const msg = 'No active SDFG editor!';
                        console.warn(msg);
                        reject(new Error(msg));
                        return;
                    }

                    this.showAssumptionsInputBox().then((value) => {
                        const [assumptions, valid] = this.checkAssumptionsInput(
                            value
                        );
                        if(valid) {
                            this.sendPostRequest(
                                '/get_depth',
                                {
                                    'sdfg': sdfg,
                                    'assumptions': assumptions,
                                },
                                (data: DaCeMessage) => {
                                    resolve(data.depthMap);
                                    void DaCeInterface.getInstance(
                                    )?.hideSpinner();
                                },
                                async (error: DaCeException) => {
                                    await this.genericErrorHandler(
                                        error.message, error.details
                                    );
                                    reject(new Error(error.message));
                                }
                            );
                        } else {
                            void DaCeInterface.getInstance()?.hideSpinner();
                        }
                    });
                }).catch((reason: unknown) => {
                    if (reason instanceof Error)
                        reject(reason);
                    else
                        reject(new Error(String(reason)));
                });
            }).catch((err: unknown) => {
                console.error(err);
            });
        });
    }

    @ICPCRequest()
    public async getAvgParallelism(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.showSpinner('Calculating Average Parallelism').then(() => {
                DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                    if (!sdfg) {
                        const msg = 'No active SDFG editor!';
                        console.warn(msg);
                        reject(new Error(msg));
                        return;
                    }


                    this.showAssumptionsInputBox().then((value) => {
                        const [assumptions, valid] = this.checkAssumptionsInput(
                            value
                        );
                        if(valid) {
                            this.sendPostRequest(
                                '/get_avg_parallelism',
                                {
                                    'sdfg': sdfg,
                                    'assumptions': assumptions,
                                },
                                (data: DaCeMessage) => {
                                    void DaCeInterface.getInstance(
                                    )?.hideSpinner();
                                    resolve(data.avgParallelismMap);
                                },
                                async (error: DaCeException) => {
                                    await this.genericErrorHandler(
                                        error.message, error.details
                                    );
                                    reject(new Error(error.message));
                                }
                            );
                        } else {
                            void DaCeInterface.getInstance()?.hideSpinner();
                        }
                    });
                }).catch((reason: unknown) => {
                    if (reason instanceof Error)
                        reject(reason);
                    else
                        reject(new Error(String(reason)));
                });
            }).catch((err: unknown) => {
                console.error(err);
            });
        });
    }

    @ICPCRequest()
    public async getOperationalIntensity(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.showSpinner('Calculating Operational Intensity').then(() => {
                DaCeVSCode.getInstance().getActiveSdfg().then((sdfg) => {
                    if (!sdfg) {
                        const msg = 'No active SDFG editor!';
                        console.warn(msg);
                        reject(new Error(msg));
                        return;
                    }

                    this.showAssumptionsInputBox().then((value) => {
                        const [assumptions, valid] = this.checkAssumptionsInput(
                            value
                        );
                        if(valid) {
                            this.showCacheParamsInputBox().then(
                                (cacheParams) => {
                                    if(cacheParams === '' ||
                                        cacheParams === undefined)
                                        cacheParams = '1024 64';
                                    this.sendPostRequest(
                                        '/get_operational_intensity',
                                        {
                                            'sdfg': sdfg,
                                            'cacheParams': cacheParams,
                                            'assumptions': assumptions,
                                        },
                                        (data: DaCeMessage) => {
                                            resolve(data.opInMap);
                                            void DaCeInterface.getInstance(
                                            )?.hideSpinner();
                                        },
                                        async (error: DaCeException) => {
                                            await this.genericErrorHandler(
                                                error.message, error.details
                                            );
                                            reject(new Error(error.message));
                                        }
                                    );
                                }
                            );
                        } else {
                            void DaCeInterface.getInstance()?.hideSpinner();
                        }
                    });
                }).catch((reason: unknown) => {
                    if (reason instanceof Error)
                        reject(reason);
                    else
                        reject(new Error(String(reason)));
                });
            }).catch((err: unknown) => {
                console.error(err);
            });
        });
    }

    public compileSdfgFromFile(
        uri: vscode.Uri, callback: (data: DaCeMessage) => void,
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
        sdfg: string, symbolMap?: Record<string, unknown>
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            this.showSpinner('Specializing').then(() => {
                this.sendPostRequest(
                    '/specialize_sdfg',
                    {
                        'sdfg': sdfg,
                        'symbol_map': symbolMap,
                    },
                    (data: DaCeMessage) => {
                        void this.hideSpinner();
                        resolve(data.sdfg);
                    },
                    async (error: DaCeException) => {
                        await this.genericErrorHandler(
                            error.message, error.details
                        );
                        reject(new Error(error.message));
                    }
                );
            }).catch((err: unknown) => {
                console.error(err);
            });
        });
    }

    @ICPCRequest()
    public async querySdfgMetadata(): Promise<MetaDictT | undefined> {
        return new Promise<MetaDictT | undefined>((resolve) => {
            if (this.daemonRunning) {
                this.sendGetRequest('/get_metadata', (data: DaCeMessage) => {
                    resolve(data.metaDict as MetaDictT);
                });
            } else {
                resolve(undefined);
            }
        });
    }

    @ICPCRequest()
    public async loadTransformations(
        sdfg: string, selectedElements: unknown
    ): Promise<JsonTransformation[] | undefined> {
        await TransformationListProvider.getInstance()?.showLoading();

        return new Promise<JsonTransformation[] | undefined>(
            (resolve, reject) => {
                if (!this.daemonRunning) {
                    resolve(undefined);
                    return;
                }

                this.sendPostRequest(
                    '/transformations',
                    {
                        sdfg: JSON.parse(sdfg) as JsonSDFG,
                        selected_elements: selectedElements,
                        permissive: false,
                    },
                    (data: DaCeMessage) => {
                        const xforms =
                            data.transformations as JsonTransformation[];
                        const docstrings = data.docstrings as
                            Record<string, string> | undefined;
                        for (const elem of xforms) {
                            let docstring = '';
                            if (docstrings)
                                docstring = docstrings[elem.transformation];
                            elem.docstring = docstring;
                        }

                        resolve(xforms);
                    },
                    async (error: DaCeException) => {
                        await this.genericErrorHandler(
                            error.message, error.details
                        );
                        reject(new Error(error.message));
                    }
                );
            }
        );
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
                        (data: DaCeMessage) => {
                            // When done adding transformations, attempt a
                            // refresh.
                            if (data.done) {
                                resolve();
                                const editor =
                                    DaCeVSCode.getInstance().activeSDFGEditor;
                                void editor?.invoke(
                                    'refreshTransformationList'
                                );
                            }
                        },
                        (error: unknown) => {
                            if (error instanceof Error)
                                reject(error);
                            else
                                reject(new Error('Unknown error occurred'));
                        }
                    );
                } else {
                    reject(new Error('No files or folders selected'));
                }
            });
        });
    }

    public isRunning(): boolean {
        return this.daemonRunning;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
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
    public onReady(): void {
        if (this.port)
            this.invoke('setPort', [this.port]).catch(console.error);
        if (this.daemonRunning)
            this.invoke('setStatus', [this.daemonRunning]).catch(console.error);
        if (this.version) {
            this.invoke(
                'setVersion',
                [
                    this.version,
                    this.versionOk,
                    this.additionalVersionInfo,
                ]
            ).catch(console.error);
        }
        super.onReady();
    }

}
