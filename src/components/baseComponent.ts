// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';

import { MessageReceiverInterface } from './messaging/messageReceiverInterface';

export abstract class BaseComponent implements MessageReceiverInterface {

    // Identifiers for code placement into the webview's HTML.
    protected readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;

    constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly type: string
    ) {
    }

    public abstract handleMessage(message: any, origin: vscode.Webview): void;

}