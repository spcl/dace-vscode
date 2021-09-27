// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { LoggingDebugSession, TerminatedEvent } from 'vscode-debugadapter';
import * as vscode from 'vscode';
import * as os from 'os';
import { DebugProtocol } from 'vscode-debugprotocol';
import { BreakpointHandler } from './breakpoint_handler';
import { DaceListener } from './dace_listener';

export interface DaceLaunchRequestArguments
    extends DebugProtocol.LaunchRequestArguments {
    noDebug?: boolean;
    cppAttachName?: string;
    pythonLaunchName?: string;
    pythonConfig?: string;
    cppConfig?: string;
    buildType?: string;
    daceDev?: boolean;
    sdfgEdit?: boolean;
}

export enum SDFGEditMode {
    CONTINUE = 'continue',
    LOAD = 'load',
    SAVE = 'save',
    TRANSFORM = 'transform',
    PROFILE = 'profile',
    REPORT = 'report',
    VERIFICATION = 'verification',
    RUN = 'run',
}

export interface SDFGEditModeItem extends vscode.QuickPickItem {
    mode: SDFGEditMode;
}

export class DaceDebuggingSession extends LoggingDebugSession {

    public static readonly DEBUG_MODE_ITEMS = [
        {
            label: 'Continue',
            description: 'Runs the SDFG and continues the program',
            mode: SDFGEditMode.CONTINUE,
        },
        {
            label: 'Run Once',
            description: 'Displays In- & Outputs of one SDFG Run',
            mode: SDFGEditMode.RUN
        },
        {
            label: 'Load',
            description: 'Load SDFG from file',
            mode: SDFGEditMode.LOAD,
        },
        {
            label: 'Save',
            description: 'Save the current SDFG',
            mode: SDFGEditMode.SAVE,
        },
        {
            label: 'Transform',
            description: 'Transform the SDFG before continuing',
            mode: SDFGEditMode.TRANSFORM,
        },
        {
            label: 'Profile',
            description: 'Profiles a run',
            mode: SDFGEditMode.PROFILE,
        },
        {
            label: 'Accuracy Report',
            description: 'Create a accuracy Report',
            mode: SDFGEditMode.REPORT
        },
        {
            label: 'Verification',
            description: 'Create an accuracy verification',
            mode: SDFGEditMode.VERIFICATION
        },
    ];

    private wspaceFolder: vscode.WorkspaceFolder | undefined;

    public constructor() {
        super();
        const wspaceFolders = vscode.workspace.workspaceFolders;
        if (!wspaceFolders) {
            const msg = 'Working folder not found, open a folder and try again';
            vscode.window.showErrorMessage(msg).then((_) => {
                this.sendEvent(new TerminatedEvent());
            });
        } else {
            this.wspaceFolder = wspaceFolders[0];
        }
    }

    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: DaceLaunchRequestArguments
    ): Promise<Thenable<void> | void> {
        if (!this.wspaceFolder) {
            let msg = 'Working folder not found, open a folder and try again';
            return vscode.window.showErrorMessage(msg).then((_) => {
                this.sendEvent(new TerminatedEvent());
                return; // abort launch
            });
        }

        const buildType = !args.buildType ? 'Debug' : args.buildType;
        const daceDev = args.daceDev;
        const portNum: string = String(DaceListener.getInstance().getPort());

        /**
         * Default:
         *   We use the default Python configuration 'Python: Current File'
         *   and set the environment variable: build_type
         * Custom:
         *   Otherwise, the user specifies the the configuration manually
         *   by passing the name of the configuration to pythonLaunchName.
         *   We then get that configuration in the launch.json file and
         *   pass it to the attribute 'entirePyConfig'
         */
        let entirePyConfig;
        if (!args.pythonConfig || args.pythonConfig === 'default') {
            entirePyConfig = {
                name: 'Python: Current File',
                type: 'python',
                request: 'launch',
                program: '${file}',
                console: 'integratedTerminal'
            };
        } else {
            if (!args.pythonLaunchName) {
                const msg =
                    'Please make sure to define "pythonLaunchName"' +
                    'for dace-debug in your launch.json file or set' +
                    '"pythonConfig" to default';
                return vscode.window.showInformationMessage(msg).then((_) => {
                    this.sendEvent(new TerminatedEvent());
                    return; // abort launch
                });
            } else {
                entirePyConfig = getConfig(
                    args.pythonLaunchName,
                    this.wspaceFolder
                );

                if (!entirePyConfig) {
                    const message =
                        'Please make sure you have a configurations' +
                        ' with the name "' +
                        args.pythonLaunchName +
                        '" in your launch.json file.';
                    return vscode.window.showErrorMessage(message).then(_ => {
                        this.sendEvent(new TerminatedEvent());
                        return; // abort launch
                    });
                }
            }
        }

        if (!entirePyConfig.env)
            entirePyConfig.env = {};
        entirePyConfig.env.DACE_compiler_build_type = buildType;
        entirePyConfig.env.DACE_port = portNum;

        // We don't want to override the value in .dace.config if the
        // dev doesn't define daceDev.
        if (daceDev !== undefined) {
            entirePyConfig.env.
                DACE_compiler_codegen_lineinfo = daceDev ? 'true' : 'false';
            entirePyConfig.justMyCode = daceDev ? 'false' : 'true';
        }

        if (args.sdfgEdit) {
            entirePyConfig.env.DACE_sdfg_edit = 'true';
            entirePyConfig.env.DACE_instrumentation_report_each_invocation =
                'false';
        }

        /**
         * Default:
         *   We detect the operating system and set
         *   'cppConfig: default (win/gdb) Attach'
         *   in the 'Python C++ Debugger configuration'
         * Custom:
         *   Otherwise, the user specifies the the configuration manually
         *   by passing the name of the configuration to cppAttachName.
         *   We then pass the name to the 'Python C++ Debugger'.
         */
        let cppAttribute;
        let cppValue;
        if (!args.cppConfig || args.cppConfig === 'default') {
            cppAttribute = 'cppConfig';
            if (os.platform().startsWith('win')) {
                cppValue = 'default (win) Attach';
            } else {
                cppValue = 'default (gdb) Attach';
            }
        } else {
            if (!args.cppAttachName) {
                const msg =
                    'Please make sure to define "cppAttachName" for ' +
                    'dace-debug in your launch.json file or set ' +
                    '"cppConfig" to default';
                return vscode.window.showInformationMessage(msg).then((_) => {
                    this.sendEvent(new TerminatedEvent());
                    return; // abort launch
                });
            } else {
                cppAttribute = 'cppAttachName';
                cppValue = args.cppAttachName;
            }
        }

        const pyCppDebuggerConfig: vscode.DebugConfiguration = {
            name: 'Python C++ Debugger',
            type: 'pythoncpp',
            request: 'launch',
            entirePythonConfig: entirePyConfig,
        };
        pyCppDebuggerConfig[cppAttribute] = cppValue;

        // Map and Set the Breakpoints
        BreakpointHandler.getInstance()?.setAllBreakpoints();

        vscode.debug.startDebugging(
            this.wspaceFolder,
            pyCppDebuggerConfig,
            undefined
        );

        this.sendEvent(new TerminatedEvent());
        this.sendResponse(response);
    }

    protected async terminateRequest(
        response: DebugProtocol.TerminateResponse
    ): Promise<void> {
        this.sendResponse(response);
    }
}

/**
 * Get the configuration in the launch.json file by looking up its name
 * @param name      The name of the configuration
 * @param folder    The folder where the .vscode folder is located
 * @returns         The configuration or undefined if not found
 */
function getConfig(
    name: string, folder: vscode.WorkspaceFolder
): any | undefined {
    const launchConfigs = vscode.workspace.getConfiguration(
        'launch',
        folder.uri
    );

    const values = launchConfigs.get('configurations');
    if (!values) {
        const message = 'Unexpected error with the launch.json file';
        vscode.window.showErrorMessage(message);
        return undefined;
    }

    return nameDefinedInLaunch(name, values);
}

/**
 * Search through all configurations in the launch.json file
 * for the configuration with launch[i].name === name
 */
function nameDefinedInLaunch(name: string, launch: any): any | undefined {
    let i = 0;
    while (launch[i]) {
        if (launch[i].name === name) {
            return launch[i];
        }
        i++;
    }
    return undefined;
}
