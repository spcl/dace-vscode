// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class TransformationHistoryItem extends TreeViewItem {

    constructor(label, tooltip, index, list) {
        super(label, tooltip, '', false, false);
        this.index = index;
        this.list = list;
    }

    // No nesting allowed.
    add_item() {}

    generate_html() {
        const item = super.generate_html();

        item.click(() => {
            if (vscode) {
                if (this.list !== undefined) {
                    this.list.selected_item = this;
                    this.list.generate_html();
                }
                vscode.postMessage({
                    type: 'dace.preview_history_point',
                    index: this.index,
                });
            }
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
        } else {
            $('<div>', {
                'class': 'transformation-history-current-badge',
                'text': 'Current SDFG',
                'title': '',
            }).appendTo(label_container);
        }

        if (this.list !== undefined && this.list.selected_item !== undefined &&
            this.list.selected_item === this)
            item.addClass('selected');

        return item;
    }

}

class TransformationHistoryList extends TreeView {

    constructor(root_element) {
        super(root_element);
        this.clear_text = 'No previously applied transformations';
        this.selected_item = undefined;
    }

    clear(clear_text = 'No previously applied transformations', notify = true) {
        this.clear_text = clear_text;
        super.clear();
        if (notify)
            this.notify_data_changed();
    }

    parse_history(history, active_index = undefined) {
        super.clear();
        for (let i = 0; i < history.length; i++) {
            const item = history[i];
            const current = (i === history.length - 1);

            if (current) {
                const item_current_state = new TransformationHistoryItem(
                    item['transformation'],
                    'Current SDFG',
                    undefined,
                    this
                );
                if (active_index === undefined)
                    this.selected_item = item_current_state;
                this.items.unshift(item_current_state);
            } else {
                const history_item = new TransformationHistoryItem(
                    item['transformation'],
                    'Preview',
                    i,
                    this
                );
                if (active_index === i)
                    this.selected_item = history_item;
                this.items.unshift(history_item);
            }
        }

        if (history.length) {
            const item_orig_sdfg = new TransformationHistoryItem(
                'Original SDFG',
                'Preview',
                -1,
                this
            );
            if (active_index === -1)
                this.selected_item = item_orig_sdfg;
            this.items.push(item_orig_sdfg);
        }

        this.notify_data_changed();
    }

    generate_html() {
        super.generate_html();
        if (this.items.length === 0)
            this.root_element.append($('<div>', {
                'class': 'empty-transformation-history-text',
                'text': this.clear_text,
            }));

        if (this.selected_item !== undefined
            && this.selected_item.element !== undefined)
            this.selected_item.element.addClass('selected');
    }

}