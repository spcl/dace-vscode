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
};

export abstract class ICPCMessagingComponent {

    protected constructor(
        private target: any,
    ) {
    }

    protected localProcedures: Map<string, ICPCProcedure> = new Map();
    protected callbacks: Map<string, ICPCCallback> =
        new Map();

    protected sendRequest(
        id: string, procedure: string, args?: any[]
    ): void {
        console.log(
            'Sending request for procedure', procedure, 'with id', id
        );
        const message: ICPCRequestMessage = {
            type: ICPCMessageType.REQUEST,
            id: id,
            procedure: procedure,
            args: args,
        };
        try {
            this.target.postMessage(message);
        } catch (e) {
            console.error(
                `Error while sending request for procedure ${procedure}`, e
            );
            console.log('Message was', message);
        }
    }

    protected sendResponse(
        id: string, response?: any, success: boolean = true
    ): void {
        console.log('Sending response for request', id);
        const message: ICPCResponseMessage = {
            type: ICPCMessageType.RESPONSE,
            id: id,
            response: response,
            success: success,
        };
        try {
            this.target.postMessage(message);
        } catch (e) {
            console.error(`Error while sending response for request ${id}`, e);
            console.log('Message was', message);
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

    public register(
        f: Function, obj?: any, name?: string, staticArgs?: any[]
    ): void {
        this.registerProcedure({ f, name, obj, staticArgs });
    }

    public deregister(fun: Function): void {
        this.localProcedures.delete(fun.name);
    }

    public async invoke(
        procedure: string, args?: any[]
    ): Promise<any> {
        console.log('Invoking procedure', procedure);
        let uuid = uuidv4();
        while (this.callbacks.has(uuid))
            uuid = uuidv4();
        return new Promise((resolve, reject) => {
            this.callbacks.set(uuid, {
                resolve: resolve,
                reject: reject,
                procedure: procedure,
            });
            this.sendRequest(uuid, procedure, args);
        });
    }

    protected async handleRequest(
        message: ICPCRequestMessage, responseHandler?: ICPCMessagingComponent
    ): Promise<void> {
        console.log('Handling request for procedure', message.procedure);
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
        console.log(
            'Handling response for request', callback?.procedure, message.id,
            message
        );
        if (callback) {
            if (message.success)
                callback.resolve(message.response);
            else
                callback.reject(message.response);
            this.callbacks.delete(message.id);
        }
    }

}
