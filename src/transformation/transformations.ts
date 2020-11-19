import * as vscode from 'vscode';

import {
    BaseTransformationItem,
    SubgraphTransformation,
    Transformation,
    TransformationCategory
} from './transformationsItem';
import { DaCeInterface } from '../daceInterface';

export class TransformationsProvider
    implements vscode.TreeDataProvider<BaseTransformationItem> {

    public static readonly CAT_SELECTION_IDX = 0;
    public static readonly CAT_VIEWPORT_IDX = 1;
    public static readonly CAT_GLOBAL_IDX = 2;
    public static readonly CAT_UNCATEGORIZED_IDX = 3;

    private static INSTANCE = new TransformationsProvider();

    private lastSelectedElements: any[] = [];

    private constructor() {
        this.categories = [
            new TransformationCategory(
                'Selection',
                'Transformations relevant to the current selection',
                true,
                []
            ),
            new TransformationCategory(
                'Viewport',
                'Transformations relevant to the current viewport',
                true,
                []
            ),
            new TransformationCategory(
                'Global',
                'Transformations relevant on a global scale',
                false,
                []
            ),
            new TransformationCategory(
                'Uncategorized',
                'Uncategorized transformations',
                false,
                []
            ),
        ];
    }

    public static getInstance(): TransformationsProvider {
        return this.INSTANCE;
    }

    private _onDidChangeTreeData: vscode.EventEmitter<BaseTransformationItem | undefined> =
        new vscode.EventEmitter<BaseTransformationItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<BaseTransformationItem | undefined> =
        this._onDidChangeTreeData.event;

    private categories: TransformationCategory[] = [];

    public getCategory(idx: any) {
        if (idx === TransformationsProvider.CAT_SELECTION_IDX ||
            idx === TransformationsProvider.CAT_VIEWPORT_IDX ||
            idx === TransformationsProvider.CAT_GLOBAL_IDX ||
            idx === TransformationsProvider.CAT_UNCATEGORIZED_IDX)
            return this.categories[idx];
        return undefined;
    }

    public clearTransformations() {
        for (const cat of this.categories)
            cat.clearTransformations();
        this.notifyTreeDataChanged();
    }

    public addUncategorizedTransformation(transformation: Transformation) {
        this.categories[
            TransformationsProvider.CAT_UNCATEGORIZED_IDX
        ].addTransformation(transformation);
    }

    public notifyTreeDataChanged() {
        this._onDidChangeTreeData.fire(undefined);
    }

    public refresh(element?: BaseTransformationItem): void {
        DaCeInterface.getInstance().loadTransformationsOld();
    }

    getTreeItem(element: BaseTransformationItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: BaseTransformationItem | undefined): vscode.ProviderResult<BaseTransformationItem[]> {
        if (element) {
            let transformations = undefined;
            if (element instanceof TransformationCategory)
                transformations = element.getTransformations();
            if (transformations)
                return Promise.resolve(transformations);
            else
                return Promise.resolve(this.categories);
        }
        return Promise.resolve(this.categories);
    }

    public getLastSelectedElements(): any[] {
        return this.lastSelectedElements;
    }

    public clearLastSelectedElements() {
        this.lastSelectedElements = [];
    }

    public async sortTransformations(viewElements: any[], selectedElements: any[]) {
        this.lastSelectedElements = selectedElements;

        const viewportTransformations = [];
        const uncatTransformations = [];
        const globalTransformations = [];
        const selectedTransformations = [];

        const catViewport =
            this.categories[TransformationsProvider.CAT_VIEWPORT_IDX];
        const catSelected =
            this.categories[TransformationsProvider.CAT_SELECTION_IDX];
        const catGlobal =
            this.categories[TransformationsProvider.CAT_GLOBAL_IDX];
        const catUncat =
            this.categories[TransformationsProvider.CAT_UNCATEGORIZED_IDX];

        let allTransformations = [];
        for (const cat of this.categories)
            for (const trafo of cat.getTransformations())
                allTransformations.push(trafo);

        for (const trafo of allTransformations) {
            // Subgraph Transformations always apply to the selection.
            if (trafo instanceof SubgraphTransformation) {
                selectedTransformations.push(trafo);
                continue;
            }

            let matched = false;
            if (trafo.json.state_id === -1 && Object.keys(trafo.json._subgraph).length === 0) {
                globalTransformations.push(trafo);
                matched = true;
            }
            if (trafo.json.state_id >= 0) {
                // Matching a node.
                if (trafo.json._subgraph) {
                    for (const node_id of Object.values(trafo.json._subgraph)) {
                        if (selectedElements.filter((e: any) =>
                            e.type === 'node' &&
                            e.sdfg_id === trafo.json.sdfg_id &&
                            e.state_id === trafo.json.state_id &&
                            e.id === Number(node_id)
                        ).length > 0) {
                            selectedTransformations.push(trafo);
                            matched = true;
                            break;
                        }
                    }

                    if (!matched) {
                        for (const node_id of Object.values(trafo.json._subgraph)) {
                            if (viewElements.filter((e: any) =>
                                e.type === 'node' &&
                                e.sdfg_id === trafo.json.sdfg_id &&
                                e.state_id === trafo.json.state_id &&
                                e.id === Number(node_id)
                            ).length > 0) {
                                viewportTransformations.push(trafo);
                                matched = true;
                                break;
                            }
                        }
                    }
                }
            } else {
                if (trafo.json._subgraph) {
                    for (const state_id of Object.values(trafo.json._subgraph)) {
                        if (selectedElements.filter((e: any) =>
                            e.type === 'state' &&
                            e.sdfg_id === trafo.json.sdfg_id &&
                            e.id === Number(state_id)
                        ).length > 0) {
                            selectedTransformations.push(trafo);
                            matched = true;
                            break;
                        }
                    }

                    if (!matched) {
                        for (const state_id of Object.values(trafo.json._subgraph)) {
                            if (viewElements.filter((e: any) =>
                                e.type === 'state' &&
                                e.sdfg_id === trafo.json.sdfg_id &&
                                e.id === Number(state_id)
                            ).length > 0) {
                                viewportTransformations.push(trafo);
                                matched = true;
                                break;
                            }
                        }
                    }
                }
            }

            if (!matched)
                uncatTransformations.push(trafo);
        }

        catViewport.setTransformations(viewportTransformations);
        catGlobal.setTransformations(globalTransformations);
        catSelected.setTransformations(selectedTransformations);
        catUncat.setTransformations(uncatTransformations);

        this.notifyTreeDataChanged();
    }

}