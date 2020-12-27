import { randomBytes } from 'crypto';
import * as net from 'net';
import { tmpdir } from 'os';
import { platform } from 'process';
import { join } from 'path';
import * as vscode from 'vscode';
import { SdfgPythonDebugSession } from './sdfgPythonDebugSession';
import { workspaceFileAccessor } from './sdfgPythonDebugger';

export class SdfgPythonInlineFactory
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

export class SdfgPythonExecutableFactory
implements vscode.DebugAdapterDescriptorFactory {

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        if (!executable) {
            const command = 'python';

            const args = [
                '-m',
                'dace.read_perf_report'
            ];

            const options = {
            };

            executable =
                new vscode.DebugAdapterExecutable(command, args, options);
            console.log('Setting the python executable');
        }

        return executable;
    }

}

export class SdfgPythonServerFactory
implements vscode.DebugAdapterDescriptorFactory {

    private server?: net.Server;

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        if (!this.server)
            this.server = net.createServer(socket => {
                const session =
                    new SdfgPythonDebugSession(workspaceFileAccessor);
                session.setRunAsServer(true);
                session.start(socket as NodeJS.ReadableStream, socket);
            }).listen(0);
        return new vscode.DebugAdapterServer(
            (this.server.address() as net.AddressInfo).port
        );
    }

    dispose() {
        this.server?.close();
    }

}

export class SdfgPythonNamedPipeServerFactory
implements vscode.DebugAdapterDescriptorFactory {

    private server?: net.Server;

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        if (!this.server) {
            const pipeName = randomBytes(10).toString('utf8');
            const pipePath = platform === 'win32' ?
                join('\\\\.\\pipe\\', pipeName) : join(tmpdir(), pipeName);
            
            this.server = net.createServer(socket => {
                const session =
                    new SdfgPythonDebugSession(workspaceFileAccessor);
                session.setRunAsServer(true);
                session.start(socket as NodeJS.ReadableStream, socket);
            });
        }

        return new vscode.DebugAdapterNamedPipeServer(
            this.server?.address() as string
        );
    }

    dispose() {
        this.server?.close();
    }

}