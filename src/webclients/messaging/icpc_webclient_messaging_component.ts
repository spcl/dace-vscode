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

        // Loop over all methods this object has available. If they are
        // marked as ICPC methods, add them to the local procedures.
        const descs = Object.getOwnPropertyDescriptors(
            Object.getPrototypeOf(this)
        );
        for (const name in descs) {
            const desc = descs[name];
            const fun = desc.value;

            if (fun && fun.remoteInvokeable)
                this.register(fun, this, name, fun.staticArgs);
        }
    }

}

/**
 * A decorator that marks a method as being available for remote invocation.
 */
export const remoteInvokeable = (staticArgs?: any[]) => {
    return (
        _target: ICPCWebclientMessagingComponent,
        _memberName: string,
        descriptor: PropertyDescriptor,
    ) => {
        descriptor.value.remoteInvokeable = true;
        descriptor.value.staticArgs = staticArgs;
    };
};
