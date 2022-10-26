import {
    ICPCMessagingComponent,
    ICPCRequestMessage
} from '../../common/messaging/icpc_messaging_component';

export class ICPCWebclientMessagingComponent extends ICPCMessagingComponent {

    public constructor(window: Window, vscode: any) {
        super(vscode);
        window.addEventListener('message', event => {
            const message: ICPCRequestMessage = event.data;
            this.handle(message);
        });
    }

}
