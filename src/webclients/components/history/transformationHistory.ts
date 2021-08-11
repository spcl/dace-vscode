// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

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
                if (vscode) {
                    if (this.list !== undefined) {
                        this.list.selectedItem = this;
                        this.list.generateHtml();
                    }
                    vscode.postMessage({
                        type: 'dace.preview_history_point',
                        index: this.index,
                    });
                }
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
                    if (vscode)
                        vscode.postMessage({
                            type: 'dace.apply_history_point',
                            index: this.index,
                        });
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

    public parseHistory(
        history: any,
        activeIndex: number | undefined = undefined
    ): void {
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