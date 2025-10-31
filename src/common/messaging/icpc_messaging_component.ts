// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { v4 as uuidv4 } from 'uuid';
import { WebviewApi } from 'vscode-webview';


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
    args?: unknown[];
    component?: string;
}

export interface ICPCResponseMessage extends ICPCMessage {
    response?: unknown;
    success: boolean;
}

export interface ICPCProcedure {
    f: (...args: any[]) => any;
    obj?: unknown;
    name?: string;
    staticArgs?: unknown[];
    internal: boolean;
}

export interface ICPCFuncProps {
    remoteInvokeable?: boolean;
    obj?: unknown;
    procName?: string;
    staticArgs?: unknown[];
    internal: boolean;
}
export type ICPCFunc = ((...args: any[]) => any) & ICPCFuncProps;

interface ICPCCallback {
    resolve: (...args: any[]) => any;
    reject: (...args: any[]) => any;
    procedure: string;
    component?: string;
}

export abstract class ICPCMessagingComponent {

    protected constructor(
        public readonly designation: string,
        protected target?: WebviewApi<unknown>
    ) {
    }

    protected initializeTarget(target: WebviewApi<unknown>): void {
        this.target = target;
    }

    protected localProcedures = new Map<string, ICPCProcedure>();
    protected callbacks = new Map<string, ICPCCallback>();
    protected requestHandlers = new Set<any>();

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
            source: source ?? this.designation,
        };

        this._doSendRequest(message);
    }

    protected sendResponse(
        id: string, response?: unknown, success: boolean = true, source?: string
    ): void {
        const message: ICPCResponseMessage = {
            type: ICPCMessageType.RESPONSE,
            id: id,
            response: response,
            success: success,
            source: source ?? this.designation,
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
                void this.handleRequest(
                    message as ICPCRequestMessage, responseHandler
                );
                break;
            case ICPCMessageType.RESPONSE:
                this.handleResponse(message as ICPCResponseMessage);
                break;
        }
    }

    public registerProcedure(procedure: ICPCProcedure): void {
        const name = procedure.name ?? procedure.f.name;
        if (this.localProcedures.has(name)) {
            throw new Error(
                `Local procedure ${name} already registered`
            );
        }
        this.localProcedures.set(name, procedure);
    }

    public register(
        f: (...args: any[]) => any, obj?: unknown,
        name?: string, staticArgs?: unknown[], internal: boolean = false
    ): void {
        this.registerProcedure({ f, name, obj, staticArgs, internal });
    }

    public deregister(fun: (...args: unknown[]) => unknown): void {
        this.localProcedures.delete(fun.name);
    }

    public async invoke(
        procedure: string, args?: any[], component?: string
    ): Promise<unknown>;

    public async invoke<T>(
        procedure: string, args?: any[], component?: string
    ): Promise<T>;

    public async invoke<T>(
        procedure: string, args?: any[], component?: string
    ): Promise<T> {
        let uuid = uuidv4();
        while (this.callbacks.has(uuid))
            uuid = uuidv4();
        return new Promise<T>((resolve, reject) => {
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
        const _responseHandler = responseHandler ?? this;
        if (procedure) {
            if (procedure.internal && message.source !== this.designation &&
                (message.source !== 'sdfgEditor' &&
                 !this.designation.startsWith('SDFV_'))) {
                throw new Error(
                    `Internal procedure ${message.procedure} called externally`
                );
            }

            try {
                const args = procedure.staticArgs ?
                    procedure.staticArgs.concat(message.args) : message.args;
                const promiseOrResponse = procedure.f.apply(
                    procedure.obj, args ?? []
                ) as unknown;
                // Await promises if the procedure is async.
                let response: unknown = undefined;
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

    private static getAllFunctionDescriptors(
        obj: unknown
    ): Record<string, PropertyDescriptor | undefined> & Record<
        string, TypedPropertyDescriptor<unknown> | undefined
    > {
        const descs: Record<string, PropertyDescriptor | undefined> & Record<
            string, TypedPropertyDescriptor<unknown> | undefined
        >= {};

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
            // Walk up inheritance.
            toCheck = Object.getPrototypeOf(toCheck);
            // Using a second getPrototypeOf in the check ensures we don't end
            // up at the base Object prototype, which avoids including
            // Object.prototype methods like toString, hasOwnProperty, etc.
        } while (toCheck && Object.getPrototypeOf(toCheck));

        return descs;
    }

    /**
     * Regsiter methods annotated with @ICPCRequest of an object to a component.
     * @param obj            The object for which to register ICPC requests.
     * @param component      The component to register the requests to.
     * @param includeIntenal If true, internal methods will also be registered.
     */
    public static registerAnnotatedProcedures(
        obj: unknown, component: ICPCMessagingComponent,
        includeIntenal: boolean = false
    ): void {
        // Loop over all methods the provided object has available. If they are
        // marked as ICPC methods, add them to the local procedures of the
        // provided component.
        const descs = ICPCMessagingComponent.getAllFunctionDescriptors(obj);
        for (const name in descs) {
            const desc = descs[name];
            const fun = desc?.value as ICPCFunc | undefined;

            if (fun?.remoteInvokeable && (!fun.internal || includeIntenal)) {
                component.register(
                    fun, obj, name, fun.staticArgs, fun.internal
                );
            }
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

    protected handleUninitializedTargetRequest(
        message: ICPCRequestMessage, responseHandler?: ICPCMessagingComponent
    ): void {
        const response: ICPCResponseMessage = {
            id: message.id,
            type: ICPCMessageType.RESPONSE,
            source: this.designation,
            response: undefined,
            success: true,
        };
        if (responseHandler) {
            responseHandler.sendResponse(
                message.id, undefined, true, responseHandler.designation
            );
        } else {
            this.handleResponse(response);
        }
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
    return (
        _obj: object, memberName: string, desc: PropertyDescriptor
    ) => {
        const func = desc.value as ICPCFunc;
        func.remoteInvokeable = true;
        func.internal = internal;
        func.procName = name ?? memberName;
        func.staticArgs = staticArgs;
    };
};
