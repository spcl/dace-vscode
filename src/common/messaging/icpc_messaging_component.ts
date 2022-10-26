import { v4 as uuidv4 } from 'uuid';

export enum ICPCMessageType {
    REQUEST = 'icpc_request',
    RESPONSE = 'icpc_response',
}

export interface ICPCMessage {
    type: ICPCMessageType;
    id: string;
    component?: string;
}

export interface ICPCRequestMessage extends ICPCMessage {
    procedure: string;
    args?: any[];
}

export interface ICPCResponseMessage extends ICPCMessage {
    response?: any;
    success: boolean;
}

export interface ICPCProcedure {
    f: Function;
    obj?: any;
    name?: string;
}

export abstract class ICPCMessagingComponent {

    protected constructor(
        private target: any,
    ) {
    }

    protected localProcedures: Map<string, ICPCProcedure> = new Map();
    protected callbacks: Map<string, { resolve: Function, reject: Function }> =
        new Map();

    protected sendRequest(
        id: string, procedure: string, args?: any[], component?: string
    ): void {
        const message: ICPCRequestMessage = {
            type: ICPCMessageType.REQUEST,
            id: id,
            procedure: procedure,
            args: args,
        };
        this.target.postMessage(message);
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
        this.target.postMessage(message);
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
            default:
                console.warn(`Unknown message type: ${message.type}`);
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

    public register(f: Function, name?: string, obj?: any): void {
        this.registerProcedure({ f, name, obj });
    }

    public deregister(fun: Function): void {
        this.localProcedures.delete(fun.name);
    }

    public async invoke(
        procedure: string, args?: any[], component?: string
    ): Promise<any> {
        let uuid = uuidv4();
        while (!this.callbacks.has(uuid))
            uuid = uuidv4();
        return new Promise((resolve, reject) => {
            this.callbacks.set(uuid, { resolve: resolve, reject: reject });
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
                let promiseOrResponse = procedure.f.apply(
                    procedure.obj, message.args
                );
                // Await promises if the procedure is async.
                const response = (
                    promiseOrResponse && typeof promiseOrResponse === 'function'
                ) ? await promiseOrResponse : promiseOrResponse;

                _responseHandler.sendResponse(message.id, response, true);
            } catch (e) {
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

}
