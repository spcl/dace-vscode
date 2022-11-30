// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as $ from 'jquery';
(window as any).jQuery = $;

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import '../../elements/treeview/treeview.css';

import './transformation_history.css';

import {
    ICPCRequest
} from '../../../common/messaging/icpc_messaging_component';
import {
    CustomTreeView,
    CustomTreeViewItem
} from '../../elements/treeview/treeview';
import {
    ICPCWebclientMessagingComponent
} from '../../messaging/icpc_webclient_messaging_component';

declare const vscode: any;

class TransformationHistoryItem extends CustomTreeViewItem {

    public constructor(
        label: string,
        tooltip: string | undefined,
        private index: number | undefined,
        list: TransformationHistoryList,
        private disabled: boolean
    ) {
        super(label, tooltip, '', false, false);
        this.list = list;
    }

    // No nesting allowed.
    public addItem(item: CustomTreeViewItem): void {}

    public generateHtml(): JQuery<HTMLElement> {
        const item = super.generateHtml();

        if (!this.disabled)
            item.on('click', () => {
                if (this.list !== undefined) {
                    this.list.selectedItem = this;
                    this.list.generateHtml();
                }
                TransformationHistoryPanel.getInstance().invoke(
                    'previewHistoryPoint', [this.index]
                );
            });
        else
            item.addClass('disabled');

        const labelContainer = item.find('.tree-view-item-label-container');

        if (this.index !== undefined && !this.disabled) {
            $('<div>', {
                'class': 'transformation-history-apply-button',
                'html': '<i class="material-icons">restore</i>&nbsp;Revert To',
                'title': '',
                'click': (e: MouseEvent) => {
                    TransformationHistoryPanel.getInstance().invoke(
                        'applyHistoryPoint', [this.index]
                    );
                    e.stopPropagation();
                },
            }).appendTo(labelContainer);
        } else if (this.index === undefined) {
            $('<div>', {
                'class': 'transformation-history-current-badge',
                'text': 'Current SDFG',
                'title': '',
            }).appendTo(labelContainer);
        }

        if (this.list !== undefined &&
            this.list.selectedItem !== undefined &&
            this.list.selectedItem === this)
            item.addClass('selected');

        return item;
    }

}

class TransformationHistoryList extends CustomTreeView {

    private clearText: string = 'No previously applied transformations';

    public constructor(rootElement: JQuery) {
        super(rootElement);
    }

    public clear(
        clearText: string = 'No previously applied transformations',
        notify: boolean = true
    ): void {
        this.clearText = clearText;
        super.clear();
        if (notify)
            this.notifyDataChanged();
    }

    public parseHistory(history: any, activeIndex?: number): void {
        super.clear();
        let encounteredDummy = false;
        for (let i = 0; i < history.length; i++) {
            const item = history[i];
            const current = (i === history.length - 1);
            if (!item)
                continue;

            if (current) {
                const itemCurrentState = new TransformationHistoryItem(
                    item['transformation'],
                    'Current SDFG',
                    undefined,
                    this,
                    false
                );
                if (activeIndex === undefined)
                    this.selectedItem = itemCurrentState;
                this.items.unshift(itemCurrentState);
            } else {
                let disabled = false;
                let tooltip = 'Preview';

                if (item['dace_unregistered']) {
                    disabled = true;
                    encounteredDummy = true;
                    tooltip = 'This transformation is not available in your ' +
                        'instance of DaCe.';
                } else if (encounteredDummy) {
                    disabled = true;
                    tooltip = 'A transformation before this one is not ' +
                        'available in your instance of DaCe.';
                }

                const historyItem = new TransformationHistoryItem(
                    item['transformation'],
                    tooltip,
                    i,
                    this,
                    disabled
                );
                if (activeIndex === i)
                    this.selectedItem = historyItem;
                this.items.unshift(historyItem);
            }
        }

        if (history.length) {
            const itemOrigSDFG = new TransformationHistoryItem(
                'Original SDFG',
                'Preview',
                -1,
                this,
                false
            );
            if (activeIndex === -1)
                this.selectedItem = itemOrigSDFG;
            this.items.push(itemOrigSDFG);
        }

        this.notifyDataChanged();
    }

    public generateHtml(): void {
        super.generateHtml();
        if (this.items.length === 0)
            this.rootElement.append($('<div>', {
                'class': 'empty-transformation-history-text',
                'text': this.clearText,
            }));

        if (this.selectedItem !== undefined &&
            this.selectedItem.element !== undefined)
            this.selectedItem.element.addClass('selected');
    }

}

class TransformationHistoryPanel extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE = new TransformationHistoryPanel();

    private constructor() {
        super();
    }

    public static getInstance(): TransformationHistoryPanel {
        return this.INSTANCE;
    }

    private transformationHistList?: TransformationHistoryList;

    public init(): void {
        super.init(vscode, window);

        this.transformationHistList = new TransformationHistoryList(
            $('#transformation-list')
        );
        this.transformationHistList.generateHtml();
        this.transformationHistList.show();

        this.invoke('refresh');
    }

    @ICPCRequest()
    public setHistory(history: any, activeIndex?: number): void {
        this.transformationHistList?.parseHistory(history, activeIndex);
    }

    @ICPCRequest()
    public clearHistory(reason?: string): void {
        if (reason !== undefined)
            this.transformationHistList?.clear(reason);
        else
            this.transformationHistList?.clear();
    }

}

$(() => {
    TransformationHistoryPanel.getInstance().init();
});
