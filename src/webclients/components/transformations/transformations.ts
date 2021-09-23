// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
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

}

export type JsonTransformation = {
    type: string | undefined,
    exp_idx: number | undefined,
    sdfg_id: number | undefined,
    state_id: number | undefined,
    _subgraph: any | undefined,
};

export class Transformation extends TransformationListItem {

    private type: string | undefined = undefined;
    private expressionIndex: number | undefined = undefined;
    private sdfgId: number = -1;
    private stateId: number = -1;
    private subgraph: any | undefined = undefined;

    public constructor(
        private json: any, list: TransformationList
    ) {
        super(json.transformation, json.docstring, '', false, true, '', '');
        this.list = list;

        this.type = json.type;
        this.expressionIndex = json.expr_index;
        this.sdfgId = json.sdfg_id;
        this.stateId = json.state_id;
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
            'click': () => {
                vscode.postMessage({
                    type: 'sdfv.apply_transformation',
                    transformation: this.json,
                });
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
        const catGlobal = new TransformationCategory(
            'Global',
            'Transformations relevant on a global scale',
            true
        );
        catGlobal.list = this;
        const catUncategorized = new TransformationCategory(
            'Uncategorized',
            'Uncategorized Transformations',
            true
        );
        catUncategorized.list = this;

        this.items = [catSelection, catViewport, catGlobal, catUncategorized];
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

    public setTransformations(transformations: Transformation[][]): void {
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
            for (let j = 0; j < category.length; j++) {
                const transformation = category[j];
                this.items[i].addItem(
                    new Transformation(transformation, this)
                );
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
