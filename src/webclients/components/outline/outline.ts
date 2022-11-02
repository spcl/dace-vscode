// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import '../../elements/treeview/treeview.css';

import './outline.css';

import * as $ from 'jquery';

import {
    CustomTreeView,
    CustomTreeViewItem,
} from '../../elements/treeview/treeview';
import {
    ICPCWebclientMessagingComponent
} from '../../messaging/icpc_webclient_messaging_component';

declare const vscode: any;
declare const media_src: string;

class OutlineItem extends CustomTreeViewItem {

    public constructor(
        icon: string | undefined,
        type: string,
        label: string,
        collapsed: boolean,
        private readonly elementUUID: string
    ) {
        super(
            collapsed ? label + ' (collapsed)' : label,
            type, icon, collapsed, true,
            type === 'SDFG' ? 'font-size: 1.1rem; font-style: italic;' : '',
            'color: var(--vscode-gitDecoration-addedResourceForeground);',
            media_src
        );
    }

    public generateHtml(): JQuery {
        const item = super.generateHtml();

        item.on('click', (e) => {
            OutlinePanel.getInstance().msgHandler?.invoke(
                'zoomToNode', [this.elementUUID]
            );
            e.stopPropagation();
        });

        item.on('mouseover', () => {
            OutlinePanel.getInstance().msgHandler?.invoke(
                'highlightElement', [this.elementUUID]
            );
        });

        return item;
    }

}

class OutlineList extends CustomTreeView {

    private clearText: string = 'No SDFG elements';

    public constructor(rootElement: JQuery) {
        super(rootElement);
    }

    public clear(
        clearText: string = 'No SDFG elements',
        notify: boolean = true
    ): void {
        super.clear();
        this.clearText = clearText;
        if (notify)
            this.notifyDataChanged();
    }

    public generateHtml(): void {
        super.generateHtml();

        if (this.items.length === 0) {
            this.rootElement.empty();
            this.rootElement.append($('<div>', {
                'class': 'empty-outline-text',
                'text': this.clearText,
            }));
        }
    }

}

class OutlinePanel {

    private static readonly INSTANCE: OutlinePanel = new OutlinePanel();

    private constructor() { }

    public static getInstance(): OutlinePanel {
        return this.INSTANCE;
    }

    private outlineList?: OutlineList;
    private messageHandler?: ICPCWebclientMessagingComponent;

    public init(): void {
        this.outlineList = new OutlineList($('#outline-list'));
        this.outlineList.generateHtml();
        this.outlineList.show();

        this.messageHandler = new ICPCWebclientMessagingComponent(
            window, vscode
        );
        this.messageHandler.register(this.setOutline, this);
        this.messageHandler.register(this.clearOutline, this);

        this.messageHandler.invoke('refresh');
    }

    public setOutline(outlineList: any[]): void {
        this.outlineList?.clear();
        this.setOutlineRecursive(outlineList, this.outlineList);
        this.outlineList?.notifyDataChanged();
    }

    private setOutlineRecursive(
        list: any[], parent?: OutlineList | OutlineItem
    ): void {
        if (!parent)
            return;

        for (const item of list) {
            const outlineItem = new OutlineItem(
                item['icon'],
                item['type'],
                item['label'],
                item['collapsed'],
                item['uuid']
            );
            outlineItem.list = this.outlineList;

            if (item['children'] !== undefined && item['children'].length)
                this.setOutlineRecursive(item['children'], outlineItem);

            parent.addItem(outlineItem);
        }
    }

    public clearOutline(reason?: string): void {
        if (reason !== undefined)
            this.outlineList?.clear(reason);
        else
            this.outlineList?.clear();
    }

    public get msgHandler(): ICPCWebclientMessagingComponent | undefined {
        return this.messageHandler;
    }

}

$(() => {
    OutlinePanel.getInstance().init();
});
