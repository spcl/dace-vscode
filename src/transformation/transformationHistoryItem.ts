import * as vscode from 'vscode';

export class TransformationHistoryItem extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly json: any,
        public readonly tooltip: string,
        public readonly isCurrent: boolean
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }

    get description(): string {
        if (this.isCurrent)
            return 'Current SDFG';
        return '';
    }

    get command(): vscode.Command {
        return {
            command: 'sdfg.previewHistoryPoint',
            title: '',
            arguments: [this],
        };
    }

    iconPath = new vscode.ThemeIcon('git-commit');

}