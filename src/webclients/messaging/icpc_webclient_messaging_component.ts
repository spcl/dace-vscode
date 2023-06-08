// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    ICPCMessagingComponent,
    ICPCRequestMessage
} from '../../common/messaging/icpc_messaging_component';
import { ComponentTarget } from '../../components/components';

export class ICPCWebclientMessagingComponent extends ICPCMessagingComponent {

    public constructor(designation: string, vscode?: any) {
        super(designation, vscode);
    }

    public init(target: any, window: Window): void {
        this.initializeTarget(target);
        window.addEventListener('message', event => {
            const message: ICPCRequestMessage = event.data;
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
