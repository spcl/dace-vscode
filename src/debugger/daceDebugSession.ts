// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { LoggingDebugSession, TerminatedEvent } from "vscode-debugadapter";
import * as vscode from "vscode";
import * as os from "os";
import { DebugProtocol } from "vscode-debugprotocol";

export interface DaceLaunchRequestArguments
    extends DebugProtocol.LaunchRequestArguments {
    noDebug?: boolean;
    cppAttachName?: string;
    pythonLaunchName?: string;
    pythonConfig?: string;
    cppConfig?: string;
    buildType?: string;
}

export class DaceDebugSession extends LoggingDebugSession {
    private folder: vscode.WorkspaceFolder | undefined;

    public constructor() {
        super();
        let folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            let msg = "Working folder not found, open a folder and try again";
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
    ): Thenable<void> | void {
        if (!this.folder) {
            let msg = "Working folder not found, open a folder and try again";
            return vscode.window.showErrorMessage(msg).then((_) => {
                this.sendEvent(new TerminatedEvent());
                return; // abort launch
            });
        }

        let buildType = !args.buildType ? "Debug" : args.buildType;

        /**
         * Default:
         *   We use the default Python configuration 'Python: Current File'
         *   and set the environment variable: build_type
         * Manual:
         *   Otherwise, the user specifies the the configuration manually
         *   by passing the name of the configuration to pythonLaunchName.
         *   We then get that configuration in the launch.json file and
         *   pass it to the attribute 'entirePyConfig'
         */
        let entirePyConfig;
        if (!args.pythonConfig || args.pythonConfig === "default") {
            entirePyConfig = {
                name: "Python: Current File",
                type: "python",
                request: "launch",
                program: "${file}",
                console: "integratedTerminal",
                env: {
                    DACE_compiler_build_type: buildType,
                },
            };
        } else {
            if (!args.pythonLaunchName) {
                let msg =
                    "Please make sure to define 'pythonLaunchName'" +
                    "for dace-debug in your launch.json file or set" +
                    "pythonConfig' to default";
                return vscode.window.showInformationMessage(msg).then((_) => {
                    this.sendEvent(new TerminatedEvent());
                    return; // abort launch
                });
            } else {
                entirePyConfig = getConfig(
                    args.pythonLaunchName,
                    this.folder
                );

                if (!entirePyConfig) {
                    let message =
                        "Please make sure you have a configurations" +
                        " with the name '" +
                        args.pythonLaunchName +
                        "' in your launch.json file.";
                    return vscode.window.showErrorMessage(message).then(_ => {
                        this.sendEvent(new TerminatedEvent());
                        return; // abort launch
                    });
                }

                /**
                 * Deppending on if the user set an environment variable
                 * or not we either add it to the variables
                 * or create an 'env' attribute
                 */
                if (entirePyConfig.env) {
                    entirePyConfig.env.DACE_compiler_build_type = buildType;
                } else {
                    entirePyConfig.env = {
                        DACE_compiler_build_type: buildType,
                    };
                }
            }
        }

        /**
         * Default:
         *   We detect the operating system and set
         *   'cppConfig: default (win/gdb) Attach'
         *   in the 'Python C++ Debugger configuration'
         * Manual:
         *   Otherwise, the user specifies the the configuration manually
         *   by passing the name of the configuration to cppAttachName.
         *   We then pass the name to the 'Python C++ Debugger'.
         */
        let cppAttribute;
        let cppValue;
        if (!args.cppConfig || args.cppConfig === "default") {
            cppAttribute = "cppConfig";
            if (os.platform().startsWith("win")) {
                cppValue = "default (win) Attach";
            } else {
                cppValue = "default (gdb) Attach";
            }
        } else {
            if (!args.cppAttachName) {
                let msg =
                    "Please make sure to define 'cppAttachName' for " +
                    "dace-debug in your launch.json file or set " +
                    "'cppConfig' to default";
                return vscode.window.showInformationMessage(msg).then((_) => {
                    this.sendEvent(new TerminatedEvent());
                    return; // abort launch
                });
            } else {
                cppAttribute = "cppAttachName";
                cppValue = args.cppAttachName;
            }
        }

        let pyCppDebuggerConfig: vscode.DebugConfiguration = {
            name: "Python C++ Debugger",
            type: "pythoncpp",
            request: "launch",
            entirePythonConfig: entirePyConfig,
        };
        pyCppDebuggerConfig[cppAttribute] = cppValue;

        vscode.debug.startDebugging(
            this.folder,
            pyCppDebuggerConfig,
            undefined
        );

        this.sendEvent(new TerminatedEvent());
        this.sendResponse(response);
    }

    protected async terminateRequest(
        response: DebugProtocol.TerminateResponse
    ) {
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
        "launch",
        folder.uri
    );

    const values = launchConfigs.get("configurations");
    if (!values) {
        let message = "Unexpected error with the launch.json file";
        vscode.window.showErrorMessage(message);
        return undefined;
    }

    return nameDefinedInLaunch(name, values);
}

/**
 * Search through all configurations in the launch.json file
 * for the configuration with launch[i].name === name
 */
function nameDefinedInLaunch(name: string, launch: any) {
    let i = 0;
    while (launch[i]) {
        if (launch[i].name === name) {
            return launch[i];
        }
        i++;
    }
    return undefined;
}
