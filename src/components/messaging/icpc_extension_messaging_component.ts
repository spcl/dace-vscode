// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import {
    ICPCMessagingComponent, ICPCRequestMessage
} from '../../common/messaging/icpc_messaging_component';
import { DaCeVSCode } from '../../extension';

export class ICPCExtensionMessagingComponent extends ICPCMessagingComponent {

    public constructor(
        public readonly designation: string,
        webview?: vscode.Webview
    ) {
        super(webview);

        ICPCHost.getInstance().registerComponent(this);

        ICPCMessagingComponent.registerAnnotatedProcedures(this, this);

        if (webview)
            this.setTarget(webview);
    }

    public setTarget(webview: vscode.Webview): void {
        this.initializeTarget(webview);
        webview.onDidReceiveMessage(message => {
            this.handle(message);
        });
    }

    public async handleRequest(
        message: ICPCRequestMessage, responseHandler?: ICPCMessagingComponent
    ): Promise<void> {
        if (message.component && message.component !== this.designation) {
            ICPCHost.getInstance().handleRequest(
                message, responseHandler || this
            );
        } else {
            if (this.localProcedures.has(message.procedure))
                super.handleRequest(message, responseHandler);
            else
                this.target?.postMessage(message);
        }
    }

}

export class ICPCHost {

    private static readonly INSTANCE: ICPCHost = new ICPCHost();

    private constructor() {}

    public static getInstance(): ICPCHost {
        return this.INSTANCE;
    }

    private readonly cmap: Map<string, ICPCExtensionMessagingComponent> =
        new Map();

    public registerComponent(component: ICPCExtensionMessagingComponent): void {
        this.cmap.set(component.designation, component);
    }

    public async handleRequest(
        message: ICPCRequestMessage, responseHandler: ICPCMessagingComponent
    ): Promise<void> {
        if (!message.component)
            throw new Error('No component specified');

        if (message.component === 'SDFV') {
            return DaCeVSCode.getInstance().getActiveEditor()?.handleRequest(
                message, responseHandler
            );
        } else {
            const component = this.cmap.get(message.component);
            if (!component)
                throw new Error(`Unknown component: ${message.component}`);
            return component.handleRequest(message, responseHandler);
        }
    }

}

