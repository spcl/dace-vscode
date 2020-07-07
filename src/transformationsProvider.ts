import * as vscode from 'vscode';
import * as cp from 'child_process';

import { Transformation } from './transformation';
import { config } from 'process';

export class TransformationsProvider
implements vscode.TreeDataProvider<Transformation> {

    private _onDidChangeTreeData: vscode.EventEmitter<Transformation | null> =
        new vscode.EventEmitter<Transformation | null>();
    readonly onDidChangeTreeData: vscode.Event<Transformation | null> =
        this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {
        vscode.window.onDidChangeActiveTextEditor(
            () => this.onActiveEditorChanged
        );
        vscode.workspace.onDidChangeTextDocument(
            e => this.onDocumentChanged(e)
        );

        this.onActiveEditorChanged();

        console.log('Starting Python deamon');
        const pythonConfig = vscode.workspace.getConfiguration('python');
        const pythonPath = pythonConfig.get<string>('pythonPath') || null;
        if (!pythonPath) {
            vscode.window.showErrorMessage('Failed to find Python executable');
        } else {
            cp.exec(
                '"' + pythonPath + '" -c "print(\'Hello world\')',
                (err, stdout, stderr) => {
                    console.log('stdout: ' + stdout);
                    console.log('stderr: ' + stderr);
                    if (err) {
                        console.log('error: ' + err);
                    }
                }
            );
        }
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
    }

}