// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import $ from 'jquery';

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-symbols';

import '../../elements/treeview/treeview.css';

import './transformations.css';

import {
    ICPCRequest,
} from '../../../common/messaging/icpc_messaging_component';
import {
    CustomTreeView,
    CustomTreeViewItem,
} from '../../elements/treeview/treeview';
import {
    ICPCWebclientMessagingComponent,
} from '../../messaging/icpc_webclient_messaging_component';
import { ComponentTarget } from '../../../components/components';
import { WebviewApi } from 'vscode-webview';

declare const vscode: WebviewApi<unknown>;

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

    public generateHtml(): JQuery {
        const item = super.generateHtml();
        item.addClass('transformation-category');
        return item;
    }

}

export interface JsonTransformation extends Record<string, unknown> {
    transformation: string;
    type?: string;
    exp_idx?: number;
    cfg_id?: number;
    sdfg_id?: number; // Legacy, succeeded by cfg_id.
    state_id?: number;
    CATEGORY?: string;
    _subgraph?: Record<string | number, string | number>;
    docstring?: string;
}

export interface JsonTransformationGroup {
    title: string;
    ordering: number;
    xforms: JsonTransformation[];
}

export interface JsonTransformationList {
    selection: JsonTransformationGroup[];
    viewport: JsonTransformationGroup[];
    passes: JsonTransformationGroup[];
    uncategorized: JsonTransformationGroup[];
};

export type JsonTransformationCategories = (
    'selection' | 'viewport' | 'passes' | 'uncategorized'
)[];

export class Transformation extends TransformationListItem {

    private name: string | undefined = undefined;
    private type: string | undefined = undefined;
    private expressionIndex: number | undefined = undefined;
    private cfgId: number = -1;
    private stateId: number = -1;
    private subgraph: Record<
        string | number, string | number
    > | undefined = undefined;

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
        this.cfgId = json.cfg_id ?? (json.sdfg_id ?? 0);
        this.stateId = json.state_id ?? 0;
        this.subgraph = json._subgraph;
    }

    public getAffectedElementsUUIDs(): string[] {
        const uuids = [];
        if (this.subgraph) {
            for (const key in this.subgraph) {
                const id = this.subgraph[key];
                if (this.stateId === -1) {
                    uuids.push(
                        String(this.cfgId) + '/' + String(id) + '/-1/-1'
                    );
                } else {
                    uuids.push(
                        String(this.cfgId) + '/' + String(this.stateId) + '/' +
                        String(id) + '/-1'
                    );
                }
            }
        }

        if (uuids.length)
            return uuids;

        uuids.push(String(this.cfgId) + '/-1/-1/-1');

        return uuids;
    }

    public generateHtml(): JQuery {
        const item = super.generateHtml();

        item.addClass('transformation');

        item.on('click', () => {
            if (this.list !== undefined) {
                this.list.selectedItem = this;
                this.list.generateHtml();
            }
            TransofrmationListPanel.selectTransformation(
                this.json
            ).catch(console.error);
        });

        const labelContainer = item.find('.tree-view-item-label-container');
        labelContainer.addClass('transformation-list-item-label-container');

        $('<div>', {
            'class': 'transformation-list-quick-apply',
            'text': 'Quick Apply',
            'title': 'Apply transformation with default parameters',
            'click': (event: Event) => {
                event.stopPropagation();
                TransofrmationListPanel.applyTransformations(
                    [this.json]
                ).catch(console.error);
                return true;
            },
        }).appendTo(labelContainer);

        item.on('mouseover', () => {
            labelContainer.addClass('hover-direct');
            TransofrmationListPanel.highlightElements(
                this.getAffectedElementsUUIDs()
            ).catch(console.error);
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
            if (this.list !== undefined) {
                this.list.selectedItem = this;
                this.list.generateHtml();
            }
            TransofrmationListPanel.selectTransformation(
                this.json
            ).catch(console.error);
        });

        const labelContainer = item.find('.tree-view-item-label-container');
        labelContainer.addClass('transformation-list-item-label-container');

        $('<div>', {
            'class': 'transformation-list-quick-apply',
            'text': 'Quick Run',
            'title': 'Run this pass with default parameters',
            'click': (event: Event) => {
                event.stopPropagation();
                TransofrmationListPanel.applyTransformations(
                    [this.json]
                ).catch(console.error);
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

        if (this.allowApplyAll) {
            $('<div>', {
                class: 'transformation-list-apply-all',
                text: 'Apply All',
                title: 'Apply all transformations with default parameters',
                click: () => {
                    TransofrmationListPanel.applyTransformations(
                        this.transformations
                    ).catch(console.error);
                },
            }).appendTo(labelContainer);
        }

        item.on('mouseover', () => {
            labelContainer.addClass('hover-direct');
            const affectedUUIDs = [];
            if (this.children) {
                for (const item of (this.children as Transformation[]))
                    affectedUUIDs.push(...item.getAffectedElementsUUIDs());
            }
            TransofrmationListPanel.highlightElements(
                affectedUUIDs
            ).catch(console.error);
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

        if (this.allowApplyAll) {
            $('<div>', {
                class: 'transformation-list-apply-all',
                text: 'Run All',
                title: 'Run all passes with default parameters',
                click: () => {
                    TransofrmationListPanel.applyTransformations(
                        this.transformations
                    ).catch(console.error);
                },
            }).appendTo(labelContainer);
        }

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
    public addItem(_item: CustomTreeViewItem): void {
        return;
    }

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

    public nItems(): number {
        let count = 0;
        for (const cat of this.items) {
            if (cat.children !== undefined)
                count += cat.children.length;
        }
        return count;
    }

    public setTransformations(transformations: JsonTransformationList): void {
        this.clear('', false);

        const allCats: JsonTransformationCategories = [
            'selection',
            'viewport',
            'passes',
            'uncategorized',
        ];
        let i = 0;
        for (const ct of allCats) {
            const groups = transformations[ct];
            for (const grp of groups) {
                if (grp.title === 'Subgraph Transformations') {
                    this.items[i].addItem(new TransformationGroup(
                        grp.title, grp.xforms, this,
                        'color: var(--vscode-textPreformat-foreground);', true
                    ));
                } else if (ct === 'passes') {
                    this.items[i].addItem(new PassPipelineGroup(
                        grp.title, grp.xforms, this,
                        'color: var(--vscode-textLink-foreground);', true
                    ));
                } else {
                    this.items[i].addItem(new TransformationGroup(
                        grp.title, grp.xforms, this,
                        'color: var(--vscode-textLink-foreground);', true
                    ));
                }
            }
            i++;
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

        if (this.selectedItem?.element !== undefined)
            this.selectedItem.element.addClass('selected');
    }

}

class TransofrmationListPanel extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE = new TransofrmationListPanel();

    private constructor() {
        super(ComponentTarget.Transformations);
    }

    public static getInstance(): TransofrmationListPanel {
        return this.INSTANCE;
    }

    private loadingIndicator?: JQuery;
    private transformationList?: TransformationList;

    public init(): void {
        super.init(vscode, window);

        this.loadingIndicator = $('#transformation-loading-indicator');
        this.transformationList = new TransformationList(
            $('#transformation-list')
        );
        this.transformationList.generateHtml();
        this.transformationList.show();

        this.invoke('onReady').catch(console.error);
    }

    @ICPCRequest()
    public deselect(): void {
        if (this.transformationList)
            this.transformationList.selectedItem = undefined;
        this.transformationList?.generateHtml();
    }

    @ICPCRequest()
    public setTransformations(
        transformations: JsonTransformationList, hideLoading: boolean = true
    ): void {
        this.transformationList?.setTransformations(transformations);
        if (hideLoading)
            this.loadingIndicator?.hide();
    }

    @ICPCRequest()
    public clearTransformations(reason?: string): void {
        this.loadingIndicator?.hide();
        if (reason !== undefined)
            this.transformationList?.clear(reason);
        else
            this.transformationList?.clear();
    }

    @ICPCRequest()
    public showLoading(): void {
        this.loadingIndicator?.show();
    }

    @ICPCRequest()
    public hideLoading(): void {
        this.loadingIndicator?.hide();
    }

    public static async selectTransformation(
        transformation: JsonTransformation
    ): Promise<void> {
        await this.INSTANCE.invokeEditorProcedure(
            'selectTransformation', [transformation]
        );
    }

    public static async applyTransformations(
        transformations: JsonTransformation[]
    ): Promise<void> {
        await this.INSTANCE.invoke(
            'applyTransformations', [transformations], ComponentTarget.DaCe
        );
    }

    public static async highlightElements(uuids: string[]): Promise<void> {
        await this.INSTANCE.invokeEditorProcedure('highlightUUIDs', [uuids]);
    }

}

$(() => {
    TransofrmationListPanel.getInstance().init();
});
