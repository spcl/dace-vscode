import * as vscode from 'vscode';

import { Transformation } from './transformation';
import { DaCeInterface } from './daceInterface';

export class TransformationsProvider
implements vscode.TreeDataProvider<Transformation> {

    private static INSTANCE = new TransformationsProvider();

    private constructor() {}

    public static getInstance(): TransformationsProvider {
        return this.INSTANCE;
    }

    private _onDidChangeTreeData: vscode.EventEmitter<Transformation | undefined> =
        new vscode.EventEmitter<Transformation | undefined>();
    readonly onDidChangeTreeData: vscode.Event<Transformation | undefined> =
        this._onDidChangeTreeData.event;

    private transformations: Transformation[] = [];

    public clearTransformations() {
        this.transformations = [];
    }

    public addTransformation(transformation: Transformation) {
        this.transformations.push(transformation);
    }

    public notifyTreeDataChanged() {
        this._onDidChangeTreeData.fire(undefined);
    }

    public refresh(element?: Transformation): void {
        DaCeInterface.getInstance().loadTransformations();
    }

    getTreeItem(element: Transformation): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: Transformation | undefined): vscode.ProviderResult<Transformation[]> {
        return Promise.resolve(this.transformations);
    }

}