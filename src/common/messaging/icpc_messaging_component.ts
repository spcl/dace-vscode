import { v4 as uuidv4 } from 'uuid';

export enum ICPCMessageType {
    REQUEST = 'icpc_request',
    RESPONSE = 'icpc_response',
}

export interface ICPCMessage {
    type: ICPCMessageType;
    id: string;
}

export interface ICPCRequestMessage extends ICPCMessage {
    procedure: string;
    args?: any[];
    component?: string;
}

export interface ICPCResponseMessage extends ICPCMessage {
    response?: any;
    success: boolean;
}

export interface ICPCProcedure {
    f: Function;
    obj?: any;
    name?: string;
    staticArgs?: any[];
}

type ICPCCallback = {
    resolve: Function;
    reject: Function;
    procedure: string;
    component?: string;
};

export abstract class ICPCMessagingComponent {

    protected constructor(
        protected target?: any,
    ) {
    }

    protected initializeTarget(target: any): void {
        this.target = target;
    }

    protected localProcedures: Map<string, ICPCProcedure> = new Map();
    protected callbacks: Map<string, ICPCCallback> =
        new Map();
    protected requestHandlers: Set<any> = new Set();

    protected sendRequest(
        id: string, procedure: string, args?: any[], component?: string
    ): void {
        const message: ICPCRequestMessage = {
            type: ICPCMessageType.REQUEST,
            id: id,
            procedure: procedure,
            args: args,
            component: component,
        };
        try {
            if (!this.target)
                throw new Error('Component uninitialized');
            this.target.postMessage(message);
        } catch (e) {
            console.error(
                `Error while sending request for procedure ${procedure}`, e
            );
            console.error('Message was', message);
        }
    }

    protected sendResponse(
        id: string, response?: any, success: boolean = true
    ): void {
        const message: ICPCResponseMessage = {
            type: ICPCMessageType.RESPONSE,
            id: id,
            response: response,
            success: success,
        };
        try {
            if (!this.target)
                throw new Error('Component uninitialized');
            this.target.postMessage(message);
        } catch (e) {
            console.error(`Error while sending response for request ${id}`, e);
            console.error('Message was', message);
        }
    }

    public handle(
        message: ICPCMessage, responseHandler?: ICPCMessagingComponent
    ): void {
        switch (message.type) {
            case ICPCMessageType.REQUEST:
                this.handleRequest(
                    message as ICPCRequestMessage, responseHandler
                );
                break;
            case ICPCMessageType.RESPONSE:
                this.handleResponse(message as ICPCResponseMessage);
                break;
        }
    }

    public registerProcedure(procedure: ICPCProcedure): void {
        const name = procedure.name || procedure.f.name;
        if (this.localProcedures.has(name))
            throw new Error(
                `Local procedure ${name} already registered`
            );
        this.localProcedures.set(name, procedure);
    }

    public register(
        f: Function, obj?: any, name?: string, staticArgs?: any[]
    ): void {
        this.registerProcedure({ f, name, obj, staticArgs });
    }

    public deregister(fun: Function): void {
        this.localProcedures.delete(fun.name);
    }

    public async invoke(
        procedure: string, args?: any[], component?: string
    ): Promise<any> {
        let uuid = uuidv4();
        while (this.callbacks.has(uuid))
            uuid = uuidv4();
        return new Promise((resolve, reject) => {
            this.callbacks.set(uuid, {
                resolve: resolve,
                reject: reject,
                procedure: procedure,
                component: component,
            });
            this.sendRequest(uuid, procedure, args, component);
        });
    }

    protected async handleRequest(
        message: ICPCRequestMessage, responseHandler?: ICPCMessagingComponent
    ): Promise<void> {
        const procedure = this.localProcedures.get(message.procedure);
        const _responseHandler = responseHandler || this;
        if (procedure) {
            try {
                const args = procedure.staticArgs ?
                    procedure.staticArgs.concat(message.args) : message.args;
                let promiseOrResponse = procedure.f.apply(procedure.obj, args);
                // Await promises if the procedure is async.
                let response = undefined;
                if (promiseOrResponse && promiseOrResponse instanceof Promise)
                    response = await promiseOrResponse;
                else
                    response = promiseOrResponse;

                _responseHandler.sendResponse(message.id, response, true);
            } catch (e) {
                console.error(e);
                _responseHandler.sendResponse(message.id, e, false);
            }
        } else {
            console.warn(`Procedure ${message.procedure} not found`);
        }
    }

    protected handleResponse(message: ICPCResponseMessage): void {
        const callback = this.callbacks.get(message.id);
        if (callback) {
            if (message.success)
                callback.resolve(message.response);
            else
                callback.reject(message.response);
            this.callbacks.delete(message.id);
        }
    }

    /**
     * Regsiter methods annotated with @ICPCRequest of an object to a component.
     * @param obj       The object for which to register ICPC requests.
     * @param component The component to register the requests to.
     */
    public static registerAnnotatedProcedures(
        obj: any, component: ICPCMessagingComponent
    ): void {
        // Loop over all methods the provided object has available. If they are
        // marked as ICPC methods, add them to the local procedures of the
        // provided component.
        const descs = Object.getOwnPropertyDescriptors(
            Object.getPrototypeOf(obj)
        );
        for (const name in descs) {
            const desc = descs[name];
            const fun = desc.value;

            if (fun && fun.remoteInvokeable)
                component.register(fun, obj, name, fun.staticArgs);
        }
    }

    /**
     * Register an ICPC request handler.
     * An ICPC request handler is an object that may have methods annotated with
     * the @ICPCRequest decorator, making them remotely invokeable.
     * @param handler The handler to register.
     */
    public registerRequestHandler(handler: any): void {
        this.requestHandlers.add(handler);
        ICPCMessagingComponent.registerAnnotatedProcedures(handler, this);
    }

}

/**
 * Marks a method as being available for remote invocation.
 * @param internal   If true, the method will not be available to components
 *                   other than the one that contains the method.
 * @param name       If provided, this name will be used to identify the method.
 * @param staticArgs If provided, these arguments will be prepended to the
 *                   arguments provided by the remote caller.
 */
export const ICPCRequest = (
    internal: boolean = false, name?: string, staticArgs?: any[]
) => {
    return (_target: any, _memberName: string, desc: PropertyDescriptor) => {
        desc.value.remoteInvokeable = true;
        desc.value.internal = internal;
        desc.value.procName = name;
        desc.value.staticArgs = staticArgs;
    };
};
