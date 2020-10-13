import * as vscode from 'vscode';

export class TransformationHistoryItem extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly json: any,
        public readonly tooltip: string,
        public readonly isCurrent: boolean
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        if (isCurrent)
            this.description = 'Current SDFG';
        else
            this.description = '';
    }

    command = {
        command: 'sdfg.previewHistoryPoint',
        title: '',
        arguments: [this],
    };

    iconPath = new vscode.ThemeIcon('git-commit');

}