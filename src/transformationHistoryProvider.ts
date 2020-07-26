import * as vscode from 'vscode';

import { TransformationHistoryItem } from './transformationHistoryItem';
import { DaCeInterface } from './daceInterface';

export class TransformationHistoryProvider
implements vscode.TreeDataProvider<TransformationHistoryItem> {

    private static INSTANCE = new TransformationHistoryProvider();

    private constructor() {}

    public static getInstance(): TransformationHistoryProvider {
        return this.INSTANCE;
    }

    private _onDidChangeTreeData: vscode.EventEmitter<TransformationHistoryItem | undefined> =
        new vscode.EventEmitter<TransformationHistoryItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<TransformationHistoryItem | undefined> =
        this._onDidChangeTreeData.event;

    private transformationHistory: TransformationHistoryItem[] = [];

    public clearHistory() {
        this.transformationHistory = [];
    }

    public addHistoryItem(item: TransformationHistoryItem) {
        this.transformationHistory.unshift(item);
    }

    public notifyTreeDataChanged() {
        this._onDidChangeTreeData.fire(undefined);
    }

    public refresh(element?: TransformationHistoryItem): void {
        DaCeInterface.getInstance().activeSdfgGetHistory();
    }

    getTreeItem(element: TransformationHistoryItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: TransformationHistoryItem | undefined): vscode.ProviderResult<TransformationHistoryItem[]> {
        return Promise.resolve(this.transformationHistory);
    }

}