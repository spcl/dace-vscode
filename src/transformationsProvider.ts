import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';

import { Transformation } from './transformation';
import { request } from 'http';

export class TransformationsProvider
implements vscode.TreeDataProvider<Transformation> {

    private _onDidChangeTreeData: vscode.EventEmitter<Transformation | undefined> =
        new vscode.EventEmitter<Transformation | undefined>();
    readonly onDidChangeTreeData: vscode.Event<Transformation | undefined> =
        this._onDidChangeTreeData.event;

    private transformations: Transformation[] = [];

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
        /*
        const pythonPath = await this.getPythonPath(null);
        const daemon = cp.spawn(
            pythonPath,
            ['-m', 'dace.transformation.interface.vscode']
        );
        */

        // TODO: Randomize port choice.
        // We poll the daemon every second to see if it's awake.
        const connectionIntervalId = setInterval(() => {
            console.log('Checking for daemon');
            const req = request({
                host: 'localhost',
                port: 5000,
                path: '/',
                method: 'GET',
                timeout: 1000,
            }, response => {
                if (response.statusCode === 200) {
                    console.log('Daemon running');
                    clearInterval(connectionIntervalId);
                    this.refresh();
                }
            });
            req.end();
        }, 1000);

        // If we were unable to connect after 10 seconds, stop trying.
        setTimeout(() => { clearInterval(connectionIntervalId); }, 10000);
    }

    constructor(private context: vscode.ExtensionContext) {
        vscode.window.onDidChangeActiveTextEditor(
            () => this.onActiveEditorChanged()
        );
        vscode.workspace.onDidChangeTextDocument(
            e => this.onDocumentChanged(e)
        );

        this.startPythonDaemon();
    }

    public refresh(element?: Transformation): void {
        this.loadTransformations();
    }

    getTreeItem(element: Transformation): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: Transformation | undefined): vscode.ProviderResult<Transformation[]> {
        return Promise.resolve(this.transformations);
    }

    private onActiveEditorChanged() {
        this.refresh();
    }

    private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent) {
        this.refresh();
    }

    private loadTransformations(): void {
        console.log('Loading transformations');

        // If there's a last active SDFG file, load that.
        const lastSdfgFileName: string | undefined =
            this.context.workspaceState.get('lastSdfgFile');
        let sdfgJson = undefined;
        if (lastSdfgFileName)
            sdfgJson = fs.readFileSync(lastSdfgFileName, 'utf8');

        if (!sdfgJson) {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                console.log('No active editor');
                return;
            }

            const document = activeEditor.document;
            if (!document.fileName.endsWith('.sdfg')) {
                console.log('Not an SDFG file');
                return;
            }

            sdfgJson = document.getText();
            if (!sdfgJson) {
                console.log('Couldn\'t load document contents');
                return;
            }
        }

        const postData = JSON.stringify(sdfgJson);
        const req = request({
            host: 'localhost',
            port: 5000,
            path: '/transformations',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length,
            },
        }, response => {
            response.setEncoding('utf8');
            response.on('data', (data) => {
                if (response.statusCode === 200) {
                    this.transformations = [];
                    const transformations_raw =
                        JSON.parse(data).transformations;
                    for (const elem of transformations_raw) {
                        const transformation = new Transformation(
                            elem.label,
                            elem,
                            vscode.TreeItemCollapsibleState.None,
                            {
                                command: 'extension.applyTransformation',
                                title: '',
                                arguments: [elem],
                            }
                        );
                        this.transformations.push(transformation);
                    }
                    // Refresh the tree view to show the new contents.
                    this._onDidChangeTreeData.fire(undefined);
                }
            });
        });
        req.write(postData);
        req.end();
    }

}