import * as vscode from 'vscode';

import { Transformation } from './transformation';
import { DaCeInterface } from '../daceInterface';

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

    public sortTransformations(elements: any) {
        const nodeList = [];
        if (elements.nodes)
            for (const node of elements.nodes)
                nodeList.push(Number(node.id));
        const stateList = [];
        if (elements.states)
            for (const state of elements.states)
                stateList.push(Number(state.id));

        let weakTransformations = [];
        let strongTransformations = [];
        for (const trafo of this.transformations) {
            let matched = false;
            if (trafo.json.state_id >= 0) {
                if (stateList.includes(trafo.json.state_id)) {
                    for (const element of Object.values(trafo.json._subgraph)) {
                        if (nodeList.includes(Number(element))) {
                            matched = true;
                            break;
                        }
                    }
                }
            }

            if (matched)
                strongTransformations.push(trafo);
            else
                weakTransformations.push(trafo);
        }
        this.transformations = strongTransformations.concat(weakTransformations);
        this.notifyTreeDataChanged();
    }

}