// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
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

declare const vscode: any;
declare const media_src: string;

let outlineList: OutlineList | null = null;

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
            if (vscode)
                vscode.postMessage({
                    type: 'sdfv.zoom_to_node',
                    uuid: this.elementUUID,
                });
            e.stopPropagation();
        });

        item.on('mouseover', () => {
            if (vscode)
                vscode.postMessage({
                    type: 'sdfv.highlight_elements',
                    elements: [this.elementUUID],
                });
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

function setOutlineRecursive(
    list: any[], parent: OutlineList | OutlineItem | null
): void {
    if (!outlineList || !parent)
        return;
    for (const item of list) {
        const outlineItem = new OutlineItem(
            item['icon'],
            item['type'],
            item['label'],
            item['collapsed'],
            item['uuid']
        );
        outlineItem.list = outlineList;

        if (item['children'] !== undefined && item['children'].length)
            setOutlineRecursive(item['children'], outlineItem);

        parent.addItem(outlineItem);
    }
}

$(() => {
    outlineList = new OutlineList($('#outline-list'));
    outlineList.generateHtml();
    outlineList.show();

    // Add a listener to receive messages from the extension.
    window.addEventListener('message', e => {
        const message = e.data;
        switch (message.type) {
            case 'set_outline':
                if (message.outlineList !== undefined) {
                    outlineList?.clear();
                    setOutlineRecursive(
                        message.outlineList,
                        outlineList
                    );
                    outlineList?.notifyDataChanged();
                }
                break;
            case 'clear_outline':
                if (message.reason !== undefined)
                    outlineList?.clear(message.reason);
                else
                    outlineList?.clear();
                break;
            default:
                break;
        }
    });

    if (vscode)
        vscode.postMessage({
            type: 'sdfv.refresh_outline',
        });
});
