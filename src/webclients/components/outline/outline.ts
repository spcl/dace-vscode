// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

declare const vscode: any;

export class OutlineItem extends CustomTreeViewItem {

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
            'color: var(--vscode-gitDecorator-addedResourceForeground);',
            undefined
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

export class OutlineList extends CustomTreeView {

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
