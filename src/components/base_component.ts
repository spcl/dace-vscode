// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import {
    ICPCExtensionMessagingComponent
} from './messaging/icpc_extension_messaging_component';


export abstract class BaseComponent extends ICPCExtensionMessagingComponent {

    // Identifiers for code placement into the webview's HTML.
    protected readonly csrSrcIdentifier = /{{ CSP_SRC }}/g;
    protected readonly scriptSrcIdentifier = /{{ SCRIPT_SRC }}/g;

    constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly type: string
    ) {
        super(type);
    }

    public async invoke(procedure: string, args?: any[]): Promise<any> {
        if (!this.target)
            return undefined;
        return super.invoke(procedure, args);
    }

}
