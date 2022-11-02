import * as vscode from 'vscode';
import {
    ICPCMessage,
    ICPCMessagingComponent,
    ICPCProcedure
} from '../../common/messaging/icpc_messaging_component';

export class ICPCExtensionMessagingComponent extends ICPCMessagingComponent {

    public constructor(webview: vscode.Webview, componentName: string) {
        super(webview);
        webview.onDidReceiveMessage(message => {
            if (message.component && message.component !== componentName)
                ICPCExtensionHost.getInstance().icHandle(message, this);
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

    public registerComponent(
        component: string, webview: vscode.Webview
    ): ICPCExtensionMessagingComponent {
        const existingHandler = this.components.get(component);
        if (existingHandler)
            return existingHandler;

        const newHandler = new ICPCExtensionMessagingComponent(
            webview, component
        );

        this.components.set(component, newHandler);
        return newHandler;
    }

    public registerProcedure(
        component: string, procedure: ICPCProcedure
    ): void {
        const handler = this.components.get(component);
        if (handler)
            handler.registerProcedure(procedure);
        else
            console.error(`Component ${component} not registered`);
    }

    public register(
        component: string, f: Function, name?: string, obj?: any
    ): void {
        this.registerProcedure(component, { f, name, obj });
    }

    public icHandle(
        message: ICPCMessage, responseHandler: ICPCExtensionMessagingComponent
    ): void {
        if (!message.component) {
            console.error('No component specified');
            return;
        }

        const component = this.components.get(message.component);
        if (component)
            component.handle(message, responseHandler);
        else
            console.error(`Component ${message.component} not registered`);
    }

}
