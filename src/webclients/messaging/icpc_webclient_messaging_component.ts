// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { WebviewApi } from 'vscode-webview';
import {
    ICPCMessagingComponent,
    ICPCRequestMessage,
} from '../../common/messaging/icpc_messaging_component';
import { ComponentTarget } from '../../components/components';

export class ICPCWebclientMessagingComponent extends ICPCMessagingComponent {

    public constructor(designation: string, vscode?: WebviewApi<unknown>) {
        super(designation, vscode);
    }

    public init(target: WebviewApi<unknown>, window: Window): void {
        this.initializeTarget(target);
        window.addEventListener('message', event => {
            const message = event.data as ICPCRequestMessage;
            this.handle(message);
        });
        ICPCMessagingComponent.registerAnnotatedProcedures(this, this, true);
    }

    public async invokeEditorProcedure(
        procedure: string, args?: any[]
    ): Promise<any> {
        return this.invoke(procedure, args, ComponentTarget.Editor);
    }

}
