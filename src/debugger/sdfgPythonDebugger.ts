// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import { SdfgPythonDebugSession } from './sdfgPythonDebugSession';
import { FileAccessor } from './sdfgPythonRuntime';

export function activateSdfgPython(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sdfg.debug.run',
            (resource: vscode.Uri) => {
                if (resource) {
                    vscode.debug.startDebugging(undefined, {
                        type: 'sdfg-python',
                        name: 'Run current SDFG',
                        request: 'launch',
                        program: resource.fsPath,
                    }, {
                        noDebug: true,
                    });
                }
            }
        ),
        vscode.commands.registerCommand(
            'sdfg.debug.profile',
            (resource: vscode.Uri) => {
                if (resource) {
                    vscode.debug.startDebugging(undefined, {
                        type: 'sdfg-python',
                        name: 'Profile current SDFG',
                        request: 'launch',
                        profile: true,
                        program: resource.fsPath,
                    }, {
                        noDebug: true,
                    });
                }
            }
        )
    );

    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(
        'sdfg-python',
        new SdfgPythonDebugConfigProvider()
    ));

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            'sdfg-python',
            new SdfgPythonInlineFactory()
        )
    );
}

class SdfgPythonDebugConfigProvider
implements vscode.DebugConfigurationProvider {

    resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        return config;
    }

}

const workspaceFileAccessor: FileAccessor = {

    async readFile(path: string): Promise<string> {
        try {
            return Buffer.from(
                await vscode.workspace.fs.readFile(vscode.Uri.file(path))
            ).toString('utf-8');
        } catch (_e) {
            // Retry once.
            try {
                return Buffer.from(
                    await vscode.workspace.fs.readFile(vscode.Uri.file(path))
                ).toString('utf-8');
            } catch (_e) {
                return `cannot read file '${path}'`;
            }
        }
    }

};

class SdfgPythonInlineFactory
implements vscode.DebugAdapterDescriptorFactory {

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(
            new SdfgPythonDebugSession(workspaceFileAccessor)
        );
    }

}