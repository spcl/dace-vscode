import * as Net from 'net';
import * as vscode from 'vscode';
import { BreakpointHandler } from './breakpointHandler';

export var PORT: number = 0;

export class DaceListener extends vscode.Disposable{

    server: Net.Server

    constructor() {
        super(() => {this.server.close()});
        this.server = this.startListening();
    }

    public startListening() {
        // Create a server to receive information from DaCe
        const server = Net.createServer((socket) => {
            socket.on('end', () => { });

            socket.on('data', data => {
                let dataStr = String.fromCharCode(...data);
                this.handleData(JSON.parse(dataStr));
            });
        })

        // listen on a random port and save the port number
        // to the exported variable PORT
        server.listen(0, () => {
            if (!server.address() || typeof server.address() === "string") {
                console.log(server.address());
                let msg = "Error occurred while starting server"
                vscode.window.showErrorMessage(msg);
            }

            let addr = server.address() as Net.AddressInfo;
            PORT = addr.port;
        });

        return server;
    }

    protected handleData(data: any | undefined) {
        console.log(data)
        if (!data) {
            return;
        }
        switch (data.type) {
            case "registerFunction":
                BreakpointHandler.getInstance()?.registerFunction(data);
                break;
            default:
                break;
        }
    }

}