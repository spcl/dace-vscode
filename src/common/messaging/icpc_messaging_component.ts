// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { v4 as uuidv4 } from 'uuid';

export enum ICPCMessageType {
    REQUEST = 'icpc_request',
    RESPONSE = 'icpc_response',
}

export interface ICPCMessage {
    type: ICPCMessageType;
    id: string;
    source: string;
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
    internal: boolean;
}

type ICPCCallback = {
    resolve: Function;
    reject: Function;
    procedure: string;
    component?: string;
};

export abstract class ICPCMessagingComponent {

    protected constructor(
        public readonly designation: string,
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

    protected _doSendRequest(message: ICPCRequestMessage): void {
        try {
            if (!this.target)
                throw new Error('Component uninitialized');
            this.target.postMessage(message);
        } catch (e) {
            console.error(
                `Error while sending request for ${message.procedure}`, e
            );
            console.error('Message was', message);
        }
    }

    protected sendRequest(
        id: string, procedure: string, args?: any[], component?: string,
        source?: string
    ): void {
        const message: ICPCRequestMessage = {
            type: ICPCMessageType.REQUEST,
            id: id,
            procedure: procedure,
            args: args,
            component: component,
            source: source || this.designation,
        };
        this._doSendRequest(message);
    }

    protected sendResponse(
        id: string, response?: any, success: boolean = true, source?: string
    ): void {
        const message: ICPCResponseMessage = {
            type: ICPCMessageType.RESPONSE,
            id: id,
            response: response,
            success: success,
            source: source || this.designation,
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
        f: Function, obj?: any, name?: string, staticArgs?: any[],
        internal: boolean = false
    ): void {
        this.registerProcedure({ f, name, obj, staticArgs, internal });
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
            if (procedure.internal && message.source !== this.designation &&
                (message.source !== 'sdfgEditor' &&
                 !this.designation.startsWith('SDFV_')))
                throw new Error(
                    `Internal procedure ${message.procedure} called externally`
                );

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

    private static getAllFunctionDescriptors(obj: any): {
        [name: string]: PropertyDescriptor,
    } & {
        [name: string]: TypedPropertyDescriptor<any>,
    } {
        const descs: {
            [name: string]: PropertyDescriptor,
        } & {
            [name: string]: TypedPropertyDescriptor<any>,
        }= {};

        let toCheck = obj;
        do {
            const localDescs = Object.getOwnPropertyDescriptors(toCheck);
            for (const name in localDescs) {
                if (descs[name])
                    continue;
                const desc = localDescs[name];
                if (typeof desc.value === 'function' && name !== 'constructor')
                    descs[name] = desc;
            }
        } while (
            toCheck = Object.getPrototypeOf(toCheck) && // Walk up inheritance.
            Object.getPrototypeOf(toCheck) // Avoid including Object methods.
        );

        return descs;
    }

    /**
     * Regsiter methods annotated with @ICPCRequest of an object to a component.
     * @param obj            The object for which to register ICPC requests.
     * @param component      The component to register the requests to.
     * @param includeIntenal If true, internal methods will also be registered.
     */
    public static registerAnnotatedProcedures(
        obj: any, component: ICPCMessagingComponent,
        includeIntenal: boolean = false
    ): void {
        // Loop over all methods the provided object has available. If they are
        // marked as ICPC methods, add them to the local procedures of the
        // provided component.
        const descs = ICPCMessagingComponent.getAllFunctionDescriptors(obj);
        for (const name in descs) {
            const desc = descs[name];
            const fun = desc.value;

            if (fun && fun.remoteInvokeable && (
                !fun.internal || includeIntenal
            ))
                component.register(
                    fun, obj, name, fun.staticArgs, fun.internal
                );
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
        ICPCMessagingComponent.registerAnnotatedProcedures(
            handler, this, false
        );
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
