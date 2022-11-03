import * as vscode from 'vscode';
import {
    ICPCMessagingComponent
} from '../../common/messaging/icpc_messaging_component';

export class ICPCExtensionMessagingComponent extends ICPCMessagingComponent {

    public constructor(webview: vscode.Webview) {
        super(webview);
        webview.onDidReceiveMessage(message => {
            this.handle(message);
        });
    }

}

