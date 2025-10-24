// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-symbols';

import '../../elements/treeview/treeview.css';

import './outline.css';

import $ from 'jquery';

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
import { IOutlineElem } from '../../../types';
import { WebviewApi } from 'vscode-webview';


declare const vscode: WebviewApi<unknown>;
declare const mediaSrc: string;

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
            mediaSrc
        );

        this.on('toggle_collapse', () => {
            void OutlinePanel.getInstance().invokeEditorProcedure(
                'toggleCollapseFor', [this.elementUUID]
            );
        });
    }

    public generateHtml(): JQuery {
        const item = super.generateHtml();

        item.on('click', (e) => {
            void OutlinePanel.getInstance().invokeEditorProcedure(
                'zoomToUUIDs', [[this.elementUUID]]
            );
            e.stopPropagation();
        });

        item.on('mouseover', () => {
            void OutlinePanel.getInstance().invokeEditorProcedure(
                'highlightUUIDs', [[this.elementUUID]]
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

class OutlinePanel extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE: OutlinePanel = new OutlinePanel();

    private constructor() {
        super(ComponentTarget.Outline);
    }

    public static getInstance(): OutlinePanel {
        return this.INSTANCE;
    }

    private outlineList?: OutlineList;

    public init(): void {
        super.init(vscode, window);

        this.outlineList = new OutlineList($('#outline-list'));
        this.outlineList.generateHtml();
        this.outlineList.show();

        void this.invoke('onReady');
    }

    @ICPCRequest()
    public setOutline(outlineList: IOutlineElem[]): void {
        this.outlineList?.clear();
        this.setOutlineRecursive(outlineList, this.outlineList);
        this.outlineList?.notifyDataChanged();
    }

    private setOutlineRecursive(
        list: IOutlineElem[], parent?: OutlineList | OutlineItem
    ): void {
        if (!parent)
            return;

        for (const item of list) {
            const outlineItem = new OutlineItem(
                item.icon,
                item.type,
                item.label,
                item.collapsed,
                item.uuid
            );
            outlineItem.list = this.outlineList;

            if (!item.collapsed) {
                if (item.children.length)
                    this.setOutlineRecursive(item.children, outlineItem);
            } else {
                outlineItem.children = [];
            }

            parent.addItem(outlineItem);
        }
    }

    @ICPCRequest()
    public clearOutline(reason?: string): void {
        if (reason !== undefined)
            this.outlineList?.clear(reason);
        else
            this.outlineList?.clear();
    }

}

$(() => {
    OutlinePanel.getInstance().init();
});
