import * as vscode from 'vscode';
import * as path from 'path';

export class Transformation extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly json: Object
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }

    get tooltip(): string {
        return this.label;
    }

    get command(): vscode.Command {
        return {
            command: 'sdfg.previewTransformation',
            title: '',
            arguments: [this],
        };
    }

    iconPath = {
        light: path.join(__filename, '..', '..', 'fileicons', 'sdfg.svg'),
        dark: path.join(__filename, '..', '..', 'fileicons', 'sdfg.svg'),
    };

}