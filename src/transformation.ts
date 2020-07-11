import * as vscode from 'vscode';
import * as path from 'path';
import { pathToFileURL } from 'url';

export class Transformation extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly elem: Object,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
    }

    get tooltip(): string {
        return this.label;
    }

    get description(): string {
        return this.label;
    }

    iconPath = {
        light: path.join(__filename, '..', '..', 'fileicons', 'sdfg.svg'),
        dark: path.join(__filename, '..', '..', 'fileicons', 'sdfg.svg'),
    };

}