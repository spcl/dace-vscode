import * as vscode from 'vscode';
import * as cp from 'child_process';

import { Transformation } from './transformation';
import { request } from 'http';

export class TransformationsProvider
implements vscode.TreeDataProvider<Transformation> {

    private _onDidChangeTreeData: vscode.EventEmitter<Transformation | null> =
        new vscode.EventEmitter<Transformation | null>();
    readonly onDidChangeTreeData: vscode.Event<Transformation | null> =
        this._onDidChangeTreeData.event;

    private async getPythonPath(document: vscode.TextDocument | null) {
        try {
            let pyExt = vscode.extensions.getExtension('ms-python.python');
            if (!pyExt)
                return 'python';

            if (pyExt.packageJSON?.featureFlags?.usingNewInterpreterStorage) {
                if (!pyExt.isActive)
                    await pyExt.activate();
                const pythonPath = pyExt.exports.settings.getExecutionDetails ?
                    pyExt.exports.settings.getExecutionDetails(document?.uri).execCommand :
                    pyExt.exports.settings.getExecutionCommand(document?.uri);
                return pythonPath ? pythonPath.join(' ') : 'python';
            } else {
                if (document)
                    return vscode.workspace.getConfiguration(
                        'python',
                        document.uri
                    ).get<string>('pythonPath');
                else
                    return vscode.workspace.getConfiguration(
                        'python'
                    ).get<string>('pythonPath');
            }
        } catch (ignored) {
            return 'python';
        }
    }

    private async startPythonDaemon() {
        const pythonPath = await this.getPythonPath(null);
        const daemon = cp.spawn(
            pythonPath,
            ['-m', 'dace.transformation.interface.vscode']
        );
        /*
        daemon.stdout.on('data', (data) => {
            console.log(data.toString());
        });
        daemon.stderr.on('data', (data) => {
            console.error(data.toString());
        });
        */

        setTimeout(() => {
            const req = request({
                host: 'localhost',
                port: 5000,
                path: '/',
                method: 'GET',
            }, response => {
                this.loadTransformations();
                //console.warn(response.statusCode);
            });
            req.end();
        }, 1000);
    }

    constructor(private context: vscode.ExtensionContext) {
        vscode.window.onDidChangeActiveTextEditor(
            () => this.onActiveEditorChanged
        );
        vscode.workspace.onDidChangeTextDocument(
            e => this.onDocumentChanged(e)
        );

        this.startPythonDaemon();

        //this.onActiveEditorChanged();
    }

    getTreeItem(element: Transformation): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return new vscode.TreeItem(
            'Test Item',
            vscode.TreeItemCollapsibleState.None
        );
    }

    getChildren(element?: Transformation | undefined): vscode.ProviderResult<Transformation[]> {
        return Promise.resolve(null);
    }

    private onActiveEditorChanged(): void {
        this.loadTransformations();
    }

    private onDocumentChanged(
        changeEvent: vscode.TextDocumentChangeEvent
    ): void {
    }

    private loadTransformations(): void {
        console.log('Loading transformations');
    }

}