// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';

export interface MessageReceiverInterface {

    handleMessage(message: any, origin: vscode.Webview): void;

}