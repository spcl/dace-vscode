// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as $ from 'jquery';
(window as any).jQuery = $;

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import '../../elements/treeview/treeview.css';

import './transformations.css';

import {
    CustomTreeView,
    CustomTreeViewItem,
} from '../../elements/treeview/treeview';

declare const vscode: any;

let transformationList: TransformationList | null = null;
let loadingIndicator: JQuery | null = null;

class TransformationListItem extends CustomTreeViewItem {

    public constructor(
        label: string,
        tooltip: string | undefined,
        icon: string | undefined,
        collapsed: boolean,
        unfoldDoubleClick: boolean,
        labelStyle: string | undefined = undefined,
        iconStyle: string | undefined = undefined
    ) {
        super(
            label, tooltip, icon, collapsed, unfoldDoubleClick, labelStyle,
            iconStyle, undefined
        );
    }

}

class TransformationCategory extends TransformationListItem {

    public constructor(
        name: string, tooltip: string | undefined, collapsed: boolean
    ) {
        super(
            name, tooltip, '', collapsed, false,
            'font-style: italic; font-size: 1.2rem;', ''
        );
    }

    public generateHtml(): JQuery<HTMLElement> {
        const item = super.generateHtml();
        item.addClass('transformation-category');
        return item;
    }

}

export type JsonTransformation = {
    transformation: string,
    type?: string,
    exp_idx?: number,
    sdfg_id?: number,
    state_id?: number,
    _category?: string,
    _subgraph?: any,
    docstring?: string,
};

export class Transformation extends TransformationListItem {

    private name: string | undefined = undefined;
    private type: string | undefined = undefined;
    private expressionIndex: number | undefined = undefined;
    private sdfgId: number = -1;
    private stateId: number = -1;
    private subgraph: any | undefined = undefined;

    public constructor(
        private json: JsonTransformation, list: TransformationList
    ) {
        super(
            json.transformation, json.docstring, undefined, false, true, '', ''
        );
        this.list = list;

        this.name = json.transformation;
        this.type = json.type;
        this.expressionIndex = json.exp_idx;
        this.sdfgId = json.sdfg_id ?? 0;
        this.stateId = json.state_id ?? 0;
        this.subgraph = json._subgraph;
    }

    public getAffectedElementsUUIDs(): string[] {
        const uuids = [];
        if (this.subgraph) {
            for (const key in this.subgraph) {
                const id = this.subgraph[key];
                if (this.stateId === -1)
                    uuids.push(this.sdfgId + '/' + id + '/-1/-1');
                else
                    uuids.push(
                        this.sdfgId + '/' + this.stateId + '/' + id + '/-1'
                    );
            }
        }

        if (uuids.length)
            return uuids;

        uuids.push(this.sdfgId + '/-1/-1/-1');

        return uuids;
    }

    public generateHtml(): JQuery {
        const item = super.generateHtml();

        item.addClass('transformation');

        item.on('click', () => {
            if (vscode) {
                if (this.list !== undefined) {
                    this.list.selectedItem = this;
                    this.list.generateHtml();
                }
                vscode.postMessage({
                    type: 'sdfv.select_transformation',
                    transformation: this.json,
                });
            }
        });

        const labelContainer = item.find('.tree-view-item-label-container');
        labelContainer.addClass('transformation-list-item-label-container');

        $('<div>', {
            'class': 'transformation-list-quick-apply',
            'text': 'Quick Apply',
            'title': 'Apply transformation with default parameters',
            'click': (event: Event) => {
                event.stopPropagation();
                vscode.postMessage({
                    type: 'sdfv.apply_transformations',
                    transformations: [this.json],
                });
                return true;
            },
        }).appendTo(labelContainer);

        item.on('mouseover', () => {
            labelContainer.addClass('hover-direct');
            if (vscode)
                vscode.postMessage({
                    type: 'sdfv.highlight_elements',
                    elements: this.getAffectedElementsUUIDs(),
                });
        });

        item.on('mouseout', () => {
            labelContainer.removeClass('hover-direct');
        });

        return item;
    }

}

export class PassPipeline extends TransformationListItem {

    private name?: string = undefined;
    private type?: string = undefined;

    public constructor(
        private json: JsonTransformation, list: TransformationList
    ) {
        super(
            json.transformation, json.docstring, undefined, false, true,
            json.type === 'Pipeline' ?
                'color: var(--vscode-textPreformat-foreground);' : '',
            ''
        );
        this.list = list;

        this.name = json.transformation;
        this.type = json.type;
    }

    public generateHtml(): JQuery {
        const item = super.generateHtml();

        item.addClass('transformation');

        item.on('click', () => {
            if (vscode) {
                if (this.list !== undefined) {
                    this.list.selectedItem = this;
                    this.list.generateHtml();
                }
                vscode.postMessage({
                    type: 'sdfv.select_transformation',
                    transformation: this.json,
                });
            }
        });

        const labelContainer = item.find('.tree-view-item-label-container');
        labelContainer.addClass('transformation-list-item-label-container');

        $('<div>', {
            'class': 'transformation-list-quick-apply',
            'text': 'Quick Run',
            'title': 'Run this pass with default parameters',
            'click': (event: Event) => {
                event.stopPropagation();
                vscode.postMessage({
                    type: 'sdfv.apply_transformations',
                    transformations: [this.json],
                });
                return true;
            },
        }).appendTo(labelContainer);

        item.on('mouseover', () => {
            labelContainer.addClass('hover-direct');
        });

        item.on('mouseout', () => {
            labelContainer.removeClass('hover-direct');
        });

        return item;
    }

}

export class TransformationGroup extends TransformationListItem {

    public constructor(
        public readonly groupName: string,
        public readonly transformations: JsonTransformation[],
        public readonly list: TransformationList,
        labelStyle: string,
        private allowApplyAll: boolean = false
    ) {
        super(
            groupName, groupName === 'SubgraphTransformations' ?
                undefined : transformations[0].docstring,
            undefined, false, false,
            labelStyle, ''
        );

        for (const xf of transformations)
            this.addItem(new Transformation(xf, list));
    }

    public generateHtml(): JQuery {
        const item = super.generateHtml();

        item.addClass('transformation-group');

        const labelContainer =
            item.find('.tree-view-item-label-container').first();
        labelContainer.addClass('transformation-list-item-label-container');

        if (this.allowApplyAll)
            $('<div>', {
                class: 'transformation-list-apply-all',
                text: 'Apply All',
                title: 'Apply all transformations with default parameters',
                click: () => {
                    vscode.postMessage({
                        type: 'sdfv.apply_transformations',
                        transformations: this.transformations,
                    });
                },
            }).appendTo(labelContainer);

        item.on('mouseover', () => {
            labelContainer.addClass('hover-direct');
            const affectedUUIDs = [];
            if (this.children)
                for (const item of (this.children as Transformation[]))
                    affectedUUIDs.push(...item.getAffectedElementsUUIDs());
            vscode.postMessage({
                type: 'sdfv.highlight_elements',
                elements: affectedUUIDs,
            });
        });

        item.on('mouseout', () => {
            labelContainer.removeClass('hover-direct');
        });

        return item;
    }

}

export class PassPipelineGroup extends TransformationListItem {

    public constructor(
        public readonly groupName: string,
        public readonly transformations: JsonTransformation[],
        public readonly list: TransformationList,
        labelStyle: string,
        private allowApplyAll: boolean = false
    ) {
        super(
            groupName, undefined, undefined, false, false,
            labelStyle, ''
        );

        for (const xf of transformations)
            this.addItem(new PassPipeline(xf, list));
    }

    public generateHtml(): JQuery {
        const item = super.generateHtml();

        item.addClass('transformation-group');

        const labelContainer =
            item.find('.tree-view-item-label-container').first();
        labelContainer.addClass('transformation-list-item-label-container');

        if (this.allowApplyAll)
            $('<div>', {
                class: 'transformation-list-apply-all',
                text: 'Run All',
                title: 'Run all passes with default parameters',
                click: () => {
                    vscode.postMessage({
                        type: 'sdfv.apply_transformations',
                        transformations: this.transformations,
                    });
                },
            }).appendTo(labelContainer);

        item.on('mouseover', () => {
            labelContainer.addClass('hover-direct');
        });

        item.on('mouseout', () => {
            labelContainer.removeClass('hover-direct');
        });

        return item;
    }
}

class TransformationList extends CustomTreeView {

    static CAT_SELECTION_IDX = 0;
    static CAT_VIEWPORT_IDX = 1;
    static CAT_GLOBAL_IDX = 2;
    static CAT_UNCATEGORIZED_IDX = 3;

    private clearText: string = 'No applicable transformations';

    public constructor(rootElement: JQuery) {
        super(rootElement);

        const catSelection = new TransformationCategory(
            'Selection',
            'Transformations relevant to the current selection',
            false
        );
        catSelection.list = this;
        const catViewport = new TransformationCategory(
            'Viewport',
            'Transformations relevant to the current viewport',
            true
        );
        catViewport.list = this;
        const catPasses = new TransformationCategory(
            'Passes & Pipelines',
            'Passes to be applied on the entire SDFG',
            true
        );
        catPasses.list = this;

        const catUncat = new TransformationCategory(
            'Uncategorized',
            'Uncategorized, remaining transformations',
            true
        );
        catUncat.list = this;
        catUncat.hidden = true;

        this.items = [catSelection, catViewport, catPasses, catUncat];
    }

    // We don't want to mutate the set of items, categories are supposed to
    // remain constant.
    public addItem(item: CustomTreeViewItem): void {}

    public clear(
        clearText = 'No applicable transformations',
        notify = true
    ): void {
        this.clearText = clearText;
        for (const cat of this.items)
            cat.children = [];
        if (notify)
            this.notifyDataChanged();
    }

    public nItems(): Number {
        let count = 0;
        for (const cat of this.items)
            if (cat.children !== undefined)
                count += cat.children.length;
        return count;
    }

    public setTransformations(transformations: JsonTransformation[][]): void {
        this.clear('', false);

        // Make sure the transformations received are the same length, if not,
        // there must be an internal error somewhere.
        if (this.items.length !== transformations.length) {
            console.error(
                'Transformation-list length mismatch! Expected ' +
                this.items.length + ' but got ' + transformations.length + '.'
            );
            return;
        }

        for (let i = 0; i < this.items.length; i++) {
            const category = transformations[i];
            const groups: {
                [key: string]: {
                    passPipeline: boolean,
                    xforms: JsonTransformation[],
                }
            } = {};
            const subgraphTransformations = [];
            for (let j = 0; j < category.length; j++) {
                const transformation = category[j];
                if (transformation.type === 'SubgraphTransformation') {
                    subgraphTransformations.push(transformation);
                } else if (
                    (
                        transformation.type === 'Pass' ||
                        transformation.type === 'Pipeline'
                    ) && transformation._category
                ) {
                    if (groups[transformation._category])
                        groups[transformation._category].xforms.push(
                            transformation
                        );
                    else
                        groups[transformation._category] = {
                            passPipeline: true,
                            xforms: [transformation],
                        };
                } else {
                    if (groups[transformation.transformation])
                        groups[transformation.transformation].xforms.push(
                            transformation
                        );
                    else
                        groups[transformation.transformation] = {
                            passPipeline: false,
                            xforms: [transformation],
                        };
                }
            }

            const sgGrpColor = 'vscode-textPreformat-foreground';
            const xfGrpColor = 'vscode-textLink-foreground';
            if (subgraphTransformations.length)
                this.items[i].addItem(new TransformationGroup(
                    'SubgraphTransformations', subgraphTransformations,
                    this, 'color: var(--' + sgGrpColor + ');',
                    false
                ));
            for (const grpName in groups) {
                const grp = groups[grpName];
                if (grp.passPipeline)
                    this.items[i].addItem(new PassPipelineGroup(
                        grpName, grp.xforms, this,
                        'color: var(--' + xfGrpColor + ');', true
                    ));
                else
                    this.items[i].addItem(new TransformationGroup(
                        grpName, grp.xforms, this,
                        'color: var(--' + xfGrpColor + ');', true
                    ));
            }
        }

        this.notifyDataChanged();
    }

    public generateHtml(): void {
        super.generateHtml();

        if (this.nItems() === 0) {
            this.rootElement.empty();
            this.rootElement.append($('<div>', {
                'class': 'empty-transformation-list-text',
                'text': this.clearText,
            }));
        }

        if (this.selectedItem !== undefined &&
            this.selectedItem.element !== undefined)
            this.selectedItem.element.addClass('selected');
    }

}

$(() => {
    loadingIndicator = $('#transformation-loading-indicator');

    transformationList = new TransformationList(
        $('#transformation-list')
    );
    transformationList.generateHtml();
    transformationList.show();

    // Add a listener to receive messages from the extension.
    window.addEventListener('message', e => {
        const message = e.data;
        switch (message.type) {
            case 'deselect':
                if (transformationList)
                    transformationList.selectedItem = undefined;
                transformationList?.generateHtml();
                break;
            case 'set_transformations':
                transformationList?.setTransformations(
                    message.transformations
                );
                if (message.hideLoading)
                    loadingIndicator?.hide();
                break;
            case 'clear_transformations':
                loadingIndicator?.hide();
                if (message.reason !== undefined)
                    transformationList?.clear(
                        message.reason
                    );
                else
                    transformationList?.clear();
                break;
            case 'show_loading':
                loadingIndicator?.show();
                break;
            case 'hide_loading':
                loadingIndicator?.hide();
                break;
            default:
                break;
        }
    });

    if (vscode)
        vscode.postMessage({
            type: 'sdfv.refresh_transformation_list',
        });
});
