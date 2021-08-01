// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class TransformationListItem extends TreeViewItem {

    constructor(
        label, tooltip, icon, init_collapsed, unfold_dblclck, label_style,
        icon_style
    ) {
        super(
            label, tooltip, icon, init_collapsed, unfold_dblclck, label_style,
            icon_style
        );
    }

}

class TransformationCategory extends TransformationListItem {

    constructor(name, tooltip, init_collapsed) {
        super(
            name, tooltip, '', init_collapsed, false,
            'font-style: italic; font-size: 1.2rem;', ''
        );
    }

}

class Transformation extends TransformationListItem {

    constructor(json, list) {
        super(json.transformation, json.docstring, '', false, true, '', '');
        this.json = json;
        this.type = json.type;
        this.exp_index = json.expr_index;
        this.sdfg_id = json.sdfg_id;
        this.state_id = json.state_id;
        this.subgraph = json._subgraph;
        this.list = list;
    }

    get_affected_element_uuids() {
        const uuids = [];
        if (this.subgraph) {
            for (const key in this.subgraph) {
                const id = this.subgraph[key];
                if (this.state_id === -1)
                    uuids.push(this.sdfg_id + '/' + id + '/-1/-1');
                else
                    uuids.push(
                        this.sdfg_id + '/' + this.state_id + '/' + id + '/-1'
                    );
            }
        }

        if (uuids.length)
            return uuids;

        uuids.push(this.sdfg_id + '/-1/-1/-1');

        return uuids;
    }

    generate_html() {
        const item = super.generate_html();

        item.on('click', () => {
            if (vscode) {
                if (this.list !== undefined) {
                    this.list.selected_item = this;
                    this.list.generate_html();
                }
                vscode.postMessage({
                    type: 'sdfv.select_transformation',
                    transformation: this.json,
                });
            }
        });

        const label_container = item.find('.tree-view-item-label-container');
        label_container.addClass('transformation-list-item-label-container');

        $('<div>', {
            'class': 'transformation-list-quick-apply',
            'text': 'Quick Apply',
            'title': 'Apply transformation with default parameters',
            'click': () => {
                vscode.postMessage({
                    type: 'dace.apply_transformation',
                    transformation: this.json,
                });
            },
        }).appendTo(label_container);

        item.on('mouseover', () => {
            label_container.addClass('hover-direct');
            if (vscode)
                vscode.postMessage({
                    type: 'sdfv.highlight_elements',
                    elements: this.get_affected_element_uuids(),
                });
        });

        item.on('mouseout', () => {
            label_container.removeClass('hover-direct');
        });

        return item;
    }

}

class TransformationList extends TreeView {

    static CAT_SELECTION_IDX = 0;
    static CAT_VIEWPORT_IDX = 1;
    static CAT_GLOBAL_IDX = 2;
    static CAT_UNCATEGORIZED_IDX = 3;

    constructor(root_element) {
        super(root_element);

        const cat_selection = new TransformationCategory(
            'Selection',
            'Transformations relevant to the current selection',
            false
        );
        cat_selection.list = this;
        const cat_viewport = new TransformationCategory(
            'Viewport',
            'Transformations relevant to the current viewport',
            true
        );
        cat_viewport.list = this;
        const cat_global = new TransformationCategory(
            'Global',
            'Transformations relevant on a global scale',
            true
        );
        cat_global.list = this;
        const cat_uncat = new TransformationCategory(
            'Uncategorized',
            'Uncategorized Transformations',
            true
        );
        cat_uncat.list = this;

        this.items = [cat_selection, cat_viewport, cat_global, cat_uncat];

        this.clear_text = 'No applicable transformations';

        this.selected_item = undefined;
    }

    // We don't want to mutate the set of items, categories are supposed to
    // remain constant.
    add_item(item){}

    clear_transformations(
        clear_text = 'No applicable transformations',
        notify = true
    ) {
        this.clear_text = clear_text;
        for (const cat of this.items)
            cat.children = [];
        if (notify)
            this.notify_data_changed();
    }

    n_items() {
        let count = 0;
        for (const cat of this.items)
            if (cat.children !== undefined)
                count += cat.children.length;
        return count;
    }

    set_transformations(transformations) {
        this.clear_transformations('', false);

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
                this.items[i].add_item(
                    new Transformation(transformation, this)
                );
            }
        }

        this.notify_data_changed();
    }

    generate_html() {
        super.generate_html();

        if (this.n_items() === 0) {
            this.root_element.empty();
            this.root_element.append($('<div>', {
                'class': 'empty-transformation-list-text',
                'text': this.clear_text,
            }));
        }

        if (this.selected_item !== undefined &&
            this.selected_item.element !== undefined)
            this.selected_item.element.addClass('selected');
    }

}