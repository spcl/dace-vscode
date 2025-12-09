// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { Webview } from 'vscode';
import {
    ICPCMessage,
    ICPCMessagingComponent,
    ICPCRequestMessage,
} from '../../common/messaging/icpc_messaging_component';
import { ComponentTarget } from '../components';
import { DaCeVSCode } from '../../dace_vscode';
import { WebviewApi } from 'vscode-webview';

export class ICPCExtensionMessagingComponent extends ICPCMessagingComponent {

    public constructor(designation: string, webview?: Webview) {
        super(designation, webview as unknown as WebviewApi<unknown>);

        ICPCHost.getInstance().registerComponent(this);

        ICPCMessagingComponent.registerAnnotatedProcedures(this, this, true);

        if (webview)
            this.setTarget(webview);
    }

    public setTarget(webview: Webview): void {
        this.initializeTarget(webview as unknown as WebviewApi<unknown>);
        webview.onDidReceiveMessage(message => {
            this.handle(message as ICPCMessage);
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
            (message.component === ComponentTarget.Editor.toString() &&
                this.designation.startsWith('SDFV_'))) {
            if (this.localProcedures.has(message.procedure)) {
                return super.handleRequest(message, responseHandler);
            } else {
                if (this.target) {
                    this.target.postMessage(message);
                } else {
                    this.handleUninitializedTargetRequest(
                        message, responseHandler
                    );
                }
            }
        } else {
            return ICPCHost.getInstance().handleRequest(
                message, responseHandler ?? this
            );
        }
    }

}

export class ICPCHost {

    private static readonly INSTANCE: ICPCHost = new ICPCHost();

    private constructor() {
        return;
    }

    public static getInstance(): ICPCHost {
        return this.INSTANCE;
    }

    private readonly cmap = new Map<string, ICPCExtensionMessagingComponent>();

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

        if (message.component === ComponentTarget.Editor.toString()) {
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

