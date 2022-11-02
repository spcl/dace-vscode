// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import {
    ICPCExtensionHost,
    ICPCExtensionMessagingComponent
} from './messaging/icpc_extension_messaging_component';


export abstract class BaseComponent {

    // Identifiers for code placement into the webview's HTML.
    protected readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;
    protected readonly scriptSrcIdentifier = /{{ SCRIPT_SRC }}/g;

    constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly type: string
    ) {
    }

}

export abstract class SingletonComponent extends BaseComponent {

    protected messageHandler?: ICPCExtensionMessagingComponent;

    protected initMessaging(component: string, webview: vscode.Webview): void {
        this.messageHandler = ICPCExtensionHost.getInstance().registerComponent(
            component, webview
        );
    }

    public async invokeRemote(procedure: string, args?: any[]): Promise<any> {
        if (!this.messageHandler)
            console.warn(this.type, 'message handler not initialized');
        return this.messageHandler?.invoke(procedure, args);
    }

}
