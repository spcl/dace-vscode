class TransformationHistoryItem extends TreeViewItem {

    constructor(label, tooltip, index) {
        super(label, tooltip, '', false, false);
        this.index = index;
    }

    // No nesting allowed.
    add_item() {}

    generate_html() {
        const item = super.generate_html();

        item.click(() => {
            if (vscode)
                vscode.postMessage({
                    type: 'dace.preview_history_point',
                    index: this.index,
                });
        });

        const label_container = item.find('.tree-view-item-label-container');

        if (this.index !== undefined) {
            $('<div>', {
                'class': 'transformation-history-apply-button',
                'html': '<i class="material-icons">restore</i>&nbsp;Revert To',
                'title': '',
                'click': (e) => {
                    if (vscode)
                        vscode.postMessage({
                            type: 'dace.apply_history_point',
                            index: this.index,
                        });
                    e.stopPropagation();
                },
            }).appendTo(label_container);
        }

        return item;
    }

}

class TransformationHistoryList extends TreeView {

    constructor(root_element) {
        super(root_element);
    }

    clear(notify = true) {
        super.clear();
        if (notify)
            this.notify_data_changed();
    }

    parse_history(history) {
        super.clear();
        for (let i = 0; i < history.length; i++) {
            const item = history[i];
            const current = (i === history.length - 1);
            const index = current ? undefined : i;
            const tooltip = current ? '' : 'Preview';
            this.items.unshift(new TransformationHistoryItem(
                item['transformation'],
                tooltip,
                index
            ));
        }

        if (history.length)
            this.items.push(new TransformationHistoryItem(
                'Original SDFG',
                'Preview',
                -1
            ));

        this.notify_data_changed();
    }

}