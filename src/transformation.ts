import * as vscode from 'vscode';

export class Transformation extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }

    get tooltip(): string {
        return this.label;
    }

    get description(): string {
        return this.label;
    }

}