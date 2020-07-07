import * as vscode from 'vscode';

import { Transformation } from './transformation';

export class TransformationsProvider
implements vscode.TreeDataProvider<Transformation> {

    constructor(private context: vscode.ExtensionContext) {
    }

    getTreeItem(element: Transformation): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: Transformation | undefined): vscode.ProviderResult<Transformation[]> {
        throw new Error("Method not implemented.");
    }

}