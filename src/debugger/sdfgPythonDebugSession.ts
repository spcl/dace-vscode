import {
    Logger,
    InitializedEvent,
    LoggingDebugSession,
    OutputEvent,
    TerminatedEvent
} from 'vscode-debugadapter';
import { FileAccessor, SdfgPythonDebuggerRuntime } from './sdfgPythonRuntime';
import { DebugProtocol } from 'vscode-debugprotocol';
import { logger } from 'vscode-debugadapter/lib/logger';

interface SdfgPythonLaunchRequestArguments
extends DebugProtocol.LaunchRequestArguments {
    program: string;
    noDebug?: boolean;
}

export class SdfgPythonDebugSession extends LoggingDebugSession {

    private runtime: SdfgPythonDebuggerRuntime;

    public constructor(fileAccessor: FileAccessor) {
        super('sdfg-python.log');

        this.runtime = new SdfgPythonDebuggerRuntime(fileAccessor);

        this.runtime.on('output', (text, filePath, line, column) => {
            const event: DebugProtocol.OutputEvent =
                new OutputEvent(`${text}\n`);
            this.sendEvent(event);
        });

        this.runtime.on('end', () => {
            this.sendEvent(new TerminatedEvent());
        });
    }

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        args: DebugProtocol.InitializeRequestArguments
    ): void {
        // Build and return the capabilities of this debug adapter.
        response.body = response.body || {};

        this.sendResponse(response);

        this.sendEvent(new InitializedEvent());
    }

    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: SdfgPythonLaunchRequestArguments
    ) {
        console.log('Launch request received');

        logger.setup(Logger.LogLevel.Verbose, true);

        this.runtime.start(args.program);

        this.sendResponse(response);
    }
}