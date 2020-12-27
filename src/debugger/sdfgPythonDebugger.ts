import * as vscode from 'vscode';
import { SdfgPythonInlineFactory } from './sdfgPythonFactories';
import { FileAccessor } from './sdfgPythonRuntime';

export function activateSdfgPython(
    context: vscode.ExtensionContext,
    factory?: vscode.DebugAdapterDescriptorFactory
) {
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

    if (!factory)
        factory = new SdfgPythonInlineFactory();

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            'sdfg-python',
            factory
        )
    );

    if ('dispose' in factory)
        context.subscriptions.push(factory);
}

class SdfgPythonDebugConfigProvider
implements vscode.DebugConfigurationProvider {

    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        console.log('Config provider called');
        
        return config;
    }

}

export const workspaceFileAccessor: FileAccessor = {

    async readFile(path: string): Promise<string> {
        console.log('reading file from path: ' + path);
        
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