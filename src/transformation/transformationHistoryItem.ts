import * as vscode from 'vscode';

export class TransformationHistoryItem extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly json: any,
        public readonly tooltip: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }

    /*
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
    */

}