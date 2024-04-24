// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { Webview } from 'vscode';
import {
    ICPCMessagingComponent, ICPCRequestMessage
} from '../../common/messaging/icpc_messaging_component';
import { ComponentTarget } from '../components';
import { DaCeVSCode } from '../../dace_vscode';

export class ICPCExtensionMessagingComponent extends ICPCMessagingComponent {

    public constructor(designation: string, webview?: Webview) {
        super(designation, webview);

        ICPCHost.getInstance().registerComponent(this);

        ICPCMessagingComponent.registerAnnotatedProcedures(this, this, true);

        if (webview)
            this.setTarget(webview);
    }

    public setTarget(webview: Webview): void {
        this.initializeTarget(webview);
        webview.onDidReceiveMessage(message => {
            this.handle(message);
        });
    }

    protected dispose(): void {
        ICPCHost.getInstance().deregister(this);
    }

    public async handleRequest(
        message: ICPCRequestMessage, responseHandler?: ICPCMessagingComponent
    ): Promise<void> {
        if (!message.component ||
            (message.component === this.designation) ||
            (message.component === ComponentTarget.Editor &&
                this.designation.startsWith('SDFV_'))) {
            if (this.localProcedures.has(message.procedure))
                super.handleRequest(message, responseHandler);
            else
                this.target?.postMessage(message);
        } else {
            ICPCHost.getInstance().handleRequest(
                message, responseHandler || this
            );
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

    public deregister(component: ICPCExtensionMessagingComponent): void {
        this.cmap.delete(component.designation);
    }

    public async handleRequest(
        message: ICPCRequestMessage, responseHandler: ICPCMessagingComponent
    ): Promise<void> {
        if (!message.component)
            throw new Error('No component specified');

        if (message.component === ComponentTarget.Editor) {
            return DaCeVSCode.getInstance().activeSDFGEditor?.handleRequest(
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

