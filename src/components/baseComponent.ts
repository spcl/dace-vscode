import * as vscode from 'vscode';

import { MessageReceiverInterface } from './messaging/messageReceiverInterface';

export abstract class BaseComponent implements MessageReceiverInterface {

    // Identifiers for code placement into the webview's HTML.
    protected readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;

    //protected static readonly viewType: string;

    constructor(protected readonly context: vscode.ExtensionContext) {
    }

    public abstract handleMessage(message: any, origin: vscode.Webview): void;

}