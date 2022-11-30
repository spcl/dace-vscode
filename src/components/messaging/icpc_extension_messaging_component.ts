import * as vscode from 'vscode';
import {
    ICPCMessagingComponent
} from '../../common/messaging/icpc_messaging_component';

export class ICPCExtensionMessagingComponent extends ICPCMessagingComponent {

    public constructor(webview?: vscode.Webview) {
        super(webview);

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

}

