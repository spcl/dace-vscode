import * as vscode from 'vscode';

export interface MessageReceiverInterface {

    handleMessage(message: any, origin: vscode.Webview): void;

}