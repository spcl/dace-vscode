// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import { DaceDebugSession } from './daceDebugSession';
import { DaCeInterface } from '../daceInterface';
import * as os from 'os';

export function activateDaceDebug(context: vscode.ExtensionContext) {

    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(
        'dace-debug',
        new DaceDebugConfigProvider()
    ));

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            'dace-debug',
            new DaceInlineFactory()
        )
    );
}

class DaceDebugConfigProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // if launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            let msg =
                "Please make sure you have a launch.json file with a " +
                "configuration of the type 'dace-debug' to use this debugger";
            return vscode.window.showInformationMessage(msg).then((_) => {
                return undefined; // abort launch
            });
        }

        if (!folder) {
            let msg = "Working folder not found, open a folder and try again";
            return vscode.window.showErrorMessage(msg).then((_) => {
                return undefined;
            });
        }

        return config;
    }

    async provideDebugConfigurations(
        folder?: vscode.WorkspaceFolder,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration[]> {
        enum configType {
            DEFAULT,
            MANUAL,
        }

        interface MenuItem extends vscode.QuickPickItem {
            type: configType;
        }

        const items: MenuItem[] = [
            {
                label: "DaCe Debugger",
                description: "Default",
                type: configType.DEFAULT,
            },
            {
                label: "DaCe Debugger",
                description: "Manual",
                type: configType.MANUAL,
            },
        ];

        const selection:
            | MenuItem
            | undefined = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a configuration",
            });
        if (!selection) {
            return []; // User canceled it.
        }

        const gdbConfig: vscode.DebugConfiguration = {
            name: "(gdb) Attach",
            type: "cppdbg",
            request: "attach",
            program: await DaCeInterface.getInstance().getPythonExecCommand(
                undefined
            ),
            processId: "",
            MIMode: "gdb",
            miDebuggerPath: "/path/to/gdb",
            setupCommands: [
                {
                    description: "Enable pretty-printing for gdb",
                    text: "-enable-pretty-printing",
                    ignoreFailures: true,
                },
            ],
        };

        const winConfig: vscode.DebugConfiguration = {
            name: "(Windows) Attach",
            type: "cppvsdbg",
            request: "attach",
            processId: "",
        };

        const pythonConfig: vscode.DebugConfiguration = {
            name: "Python: Current File",
            type: "python",
            request: "launch",
            program: "${file}",
            console: "integratedTerminal",
        };

        let daceConfig: vscode.DebugConfiguration = {
            name: "DaCe Debugger",
            type: "dace-debug",
            request: "launch",
            pythonConfig: "default",
            cppConfig: "default",
        };

        switch (selection.type) {
            case configType.MANUAL:
                daceConfig.pythonConfig = "manual";
                daceConfig.cppConfig = "manual";
                daceConfig.pythonLaunchName = "Python: Current File";

                if (os.platform().startsWith("win")) {
                    daceConfig.cppAttachName = "(Windows) Attach";
                    return [daceConfig, pythonConfig, winConfig];
                } else {
                    daceConfig.cppAttachName = "(gdb) Attach";
                    return [daceConfig, pythonConfig, winConfig];
                }

            case configType.DEFAULT:
                daceConfig.pythonConfig = "default";
                daceConfig.cppConfig = "default";
                return [daceConfig];

            default:
                break;
        }

        return [];
    }
}

class DaceInlineFactory
    implements vscode.DebugAdapterDescriptorFactory {

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(
            new DaceDebugSession()
        );
    }

}