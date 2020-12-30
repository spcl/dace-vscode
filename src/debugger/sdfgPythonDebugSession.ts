import {
    Logger,
    InitializedEvent,
    LoggingDebugSession,
    OutputEvent,
    TerminatedEvent
} from 'vscode-debugadapter';
import { FileAccessor, SdfgPythonDebuggerRuntime } from './sdfgPythonRuntime';
import { DebugProtocol } from 'vscode-debugprotocol';

export interface SdfgPythonLaunchRequestArguments
extends DebugProtocol.LaunchRequestArguments {
    program?: string;
    noDebug?: boolean;
    profile?: boolean;
}

export class SdfgPythonDebugSession extends LoggingDebugSession {

    private runtime: SdfgPythonDebuggerRuntime;

    public constructor(fileAccessor: FileAccessor) {
        super();

        this.runtime = new SdfgPythonDebuggerRuntime(fileAccessor);

        this.initEventListeners();
    }

    private initEventListeners() {
        this.runtime.on('output', (text) => {
            this.sendEvent(new OutputEvent(`${text}\n`));
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
        Logger.logger.setup(Logger.LogLevel.Verbose, true);

        this.runtime.start(args);

        this.sendResponse(response);
    }
}