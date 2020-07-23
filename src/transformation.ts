import * as vscode from 'vscode';
import * as path from 'path';

export class Transformation extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly json: any,
        public readonly docstring: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }

    get tooltip(): string {
        return this.docstring;
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