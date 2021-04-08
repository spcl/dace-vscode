// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

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
        this.runtime.on('output', (text, cat) => {
            if (cat === undefined)
                cat = 'stdout';
            this.sendEvent(new OutputEvent(`${text}\n`, cat));
        });

        this.runtime.on('end', () => {
            this.sendEvent(new TerminatedEvent());
        });
    }

    protected async initializeRequest(
        response: DebugProtocol.InitializeResponse,
        _args: DebugProtocol.InitializeRequestArguments
    ) {
        // Build and return the capabilities of this debug adapter.
        response.body = response.body || {};

        // To kill our spawned child processes, we need to manually terminate
        // them when a terminate request is sent. This means we need to support
        // and implement it.
        response.body.supportsTerminateRequest = true;

        // Do not support restart requests, because we want VSCode to emulate
        // this behavior by killing our debug adapter and restarting it itself,
        // saving us from having to do that manually.
        // (https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Restart)
        response.body.supportsRestartRequest = false;

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

    protected async terminateRequest(
        response: DebugProtocol.TerminateResponse
    ) {
        this.runtime.terminateRunning();

        this.sendResponse(response);
    }

}