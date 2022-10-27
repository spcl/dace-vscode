import * as vscode from 'vscode';
import {
    ICPCMessage,
    ICPCMessagingComponent,
    ICPCProcedure
} from '../../common/messaging/icpc_messaging_component';

export class ICPCExtensionMessagingComponent extends ICPCMessagingComponent {

    public constructor(webview: vscode.Webview) {
        super(webview);
        webview.onDidReceiveMessage(message => {
            if (message.component)
                ICPCExtensionHost.getInstance().icHandle(message);
            else
                this.handle(message);
        });
    }

}

export class ICPCExtensionHost {

    private static INSTANCE = new ICPCExtensionHost();

    private constructor() { }

    public static getInstance(): ICPCExtensionHost {
        return this.INSTANCE;
    }

    private components: Map<string, ICPCExtensionMessagingComponent> =
        new Map();

    public registerComponent(component: string, webview: vscode.Webview) {
        if (this.components.has(component))
            throw new Error(`Component ${component} already registered`);
        this.components.set(
            component, new ICPCExtensionMessagingComponent(webview)
        );
    }

    public registerProcedure(
        component: string, procedure: ICPCProcedure
    ): void {
        const handler = this.components.get(component);
        if (!handler)
            throw new Error(`Component ${component} not registered`);
        handler.registerProcedure(procedure);
    }

    public register(
        component: string, f: Function, name?: string, obj?: any
    ): void {
        this.registerProcedure(component, { f, name, obj });
    }

    public icHandle(message: ICPCMessage): void {
        if (!message.component)
        const component = this.components.get(message.component);
    }

}
