// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    ICPCMessagingComponent,
    ICPCRequestMessage
} from '../../common/messaging/icpc_messaging_component';

export class ICPCWebclientMessagingComponent extends ICPCMessagingComponent {

    public constructor(vscode?: any) {
        super(vscode);
    }

    public init(target: any, window: Window): void {
        this.initializeTarget(target);
        window.addEventListener('message', event => {
            const message: ICPCRequestMessage = event.data;
            this.handle(message);
        });
        ICPCMessagingComponent.registerAnnotatedProcedures(this, this);
    }

}
