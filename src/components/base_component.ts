// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import {
    ICPCExtensionMessagingComponent
} from './messaging/icpc_extension_messaging_component';
import {
    ICPCRequest,
    ICPCRequestMessage
} from '../common/messaging/icpc_messaging_component';


export abstract class BaseComponent extends ICPCExtensionMessagingComponent {

    // Identifiers for code placement into the webview's HTML.
    protected readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;
    protected readonly scriptSrcIdentifier = /{{ SCRIPT_SRC }}/g;

    private isReady: boolean = false;
    private readonly pcMap: Map<string, ICPCRequestMessage> = new Map();

    constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly type: string,
        webview?: vscode.Webview
    ) {
        super(type, webview);
    }

    protected _doSendRequest(message: ICPCRequestMessage): void {
        if (!this.isReady || !this.target)
            this.pcMap.set(message.procedure, message);
        else
            super._doSendRequest(message);
    }

    private processQueuedRequests(): void {
        for (const request of this.pcMap.values())
            super._doSendRequest(request);
    }

    @ICPCRequest(true)
    public async onReady(): Promise<void> {
        this.isReady = true;
        this.processQueuedRequests();
    }

}
