// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { LoggingDebugSession, TerminatedEvent } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import * as os from 'os';
import { BreakpointHandler } from './breakpoint_handler';
import { DACE_DEBUG_PORT } from './dace_listener';


export interface LaunchConfigEntry {
    name: string;
    type: string;
    env?: Record<string, string>;
}

export interface DaceLaunchRequestArguments
    extends DebugProtocol.LaunchRequestArguments {
    noDebug?: boolean;
    cppAttachName?: string;
    pythonLaunchName?: string;
    pythonConfig?: string;
    cppConfig?: string;
    buildType?: string;
    daCeDev?: boolean;
}

export class DaceDebuggingSession extends LoggingDebugSession {

    private folder: vscode.WorkspaceFolder | undefined;

    public constructor() {
        super();
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            const msg = 'Working folder not found, open a folder and try again';
            vscode.window.showErrorMessage(msg).then((_) => {
                this.sendEvent(new TerminatedEvent());
            });
            return;
        }
        this.folder = folders[0];
    }

    protected launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: DaceLaunchRequestArguments
    ): void {
        if (!this.folder) {
            const msg = 'Working folder not found, open a folder and try again';
            vscode.window.showErrorMessage(msg).then((_) => {
                this.sendEvent(new TerminatedEvent());
                return; // abort launch
            });
            return;
        }

        const buildType = args.buildType ?? 'Debug';
        const daceDev = args.daCeDev;
        const portNum: string = String(DACE_DEBUG_PORT);

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
                console: 'integratedTerminal',
                env: {
                    DACE_compiler_build_type: buildType,
                    DACE_port: portNum,
                    DACE_compiler_codegen_lineinfo: 'false',
                },
            };
        } else {
            if (!args.pythonLaunchName) {
                const msg =
                    'Please make sure to define \'pythonLaunchName\'' +
                    'for dace-debug in your launch.json file or set ' +
                    '\'pythonConfig\' to default';
                vscode.window.showInformationMessage(msg).then((_) => {
                    this.sendEvent(new TerminatedEvent());
                    return; // abort launch
                });
                return;
            } else {
                entirePyConfig = getConfig(
                    args.pythonLaunchName,
                    this.folder
                );

                if (!entirePyConfig) {
                    const message =
                        'Please make sure you have a configurations' +
                        ' with the name \'' +
                        args.pythonLaunchName +
                        '\' in your launch.json file.';
                    vscode.window.showErrorMessage(message).then(_ => {
                        this.sendEvent(new TerminatedEvent());
                        return; // abort launch
                    });
                    return;
                }

                /**
                 * Depending on if the user set an environment variable
                 * or not we either add it to the variables
                 * or create an 'env' attribute
                 */
                if (entirePyConfig.env) {
                    entirePyConfig.env.DACE_compiler_build_type = buildType;
                    entirePyConfig.env.DACE_port = portNum;
                    entirePyConfig.env.DACE_compiler_codegen_lineinfo = 'false';
                } else {
                    entirePyConfig.env = {
                        DACE_compiler_build_type: buildType,
                        DACE_port: portNum,
                        DACE_compiler_codegen_lineinfo: 'false',
                    };
                }
            }
        }

        // We don't want to override the value in .dace.config if the
        // dev doesn't define daceDev
        if (daceDev !== undefined && entirePyConfig.env) {
            entirePyConfig.env.DACE_compiler_codegen_lineinfo =
                daceDev ? 'true' : 'false';
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
            if (os.platform().startsWith('win'))
                cppValue = 'default (win) Attach';
            else
                cppValue = 'default (gdb) Attach';
        } else {
            if (!args.cppAttachName) {
                const msg =
                    'Please make sure to define \'cppAttachName\' for ' +
                    'dace-debug in your launch.json file or set ' +
                    '\'cppConfig\' to default';
                vscode.window.showInformationMessage(msg).then((_) => {
                    this.sendEvent(new TerminatedEvent());
                    return; // abort launch
                });
                return;
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
            this.folder,
            pyCppDebuggerConfig,
            undefined
        );

        this.sendEvent(new TerminatedEvent());
        this.sendResponse(response);
    }

    protected terminateRequest(
        response: DebugProtocol.TerminateResponse
    ): void {
        this.sendResponse(response);
    }

}

/**
 * Get the configuration in the launch.json file by looking up its name
 * @param name      The name of the configuration
 * @param folder    The folder where the .vscode folder is located
 * @returns         The configuration or undefined if not found
 */
function getConfig(name: string, folder: vscode.WorkspaceFolder) {
    const launchConfigs = vscode.workspace.getConfiguration(
        'launch',
        folder.uri
    );

    const values = launchConfigs.get<LaunchConfigEntry[]>('configurations');
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
function nameDefinedInLaunch(
    name: string, launch: LaunchConfigEntry[]
): LaunchConfigEntry | undefined {
    let i = 0;
    while (launch[i]) {
        if (launch[i].name === name)
            return launch[i];
        i++;
    }
    return undefined;
}
