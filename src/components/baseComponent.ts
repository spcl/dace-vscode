import * as vscode from 'vscode';

import { MessageReceiverInterface } from './messaging/messageReceiverInterface';

export abstract class BaseComponent implements MessageReceiverInterface {

    constructor(protected readonly context: vscode.ExtensionContext) {
    }

    public abstract handleMessage(message: any, origin: vscode.Webview): void;

}