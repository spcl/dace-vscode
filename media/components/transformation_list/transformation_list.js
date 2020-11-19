class TransformationListItem extends TreeViewItem {

    constructor(label, tooltip) {
        super(label, tooltip);
    }

}

class TransformationCategory extends TransformationListItem {

    constructor(name, tooltip) {
        super(name, tooltip);
    }

}

class Transformation extends TransformationListItem {

    constructor(name, docstring, type, exp_index, sdfg_id, state_id, subgraph) {
        super(name, docstring);
        this.type = type;
        this.exp_index = exp_index;
        this.sdfg_id = sdfg_id;
        this.state_id = state_id;
        this.subgraph = subgraph;
    }

    get_affected_element_uuids() {
        const uuids = [];
        if (this.subgraph)
            for (const key in this.subgraph) {
                const id = this.subgraph[key];
                if (this.state_id === -1)
                    uuids.push(this.sdfg_id + '/' + id + '/-1/-1');
                else
                    uuids.push(
                        this.sdfg_id + '/' + this.state_id + '/' + id + '/-1'
                    );
            }
        else
            uuids.push('-1/-1/-1/-1');
        return uuids;
    }

    generate_html() {
        const item = super.generate_html();

        item.click(() => {
            if (vscode)
                vscode.postMessage({
                    type: 'sdfv.zoom_to_elements',
                    elements: this.get_affected_element_uuids(),
                });
        });

        item.mouseover(() => {
            if (vscode)
                vscode.postMessage({
                    type: 'sdfv.highlight_elements',
                    elements: this.get_affected_element_uuids(),
                });
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
            'Transformations relevant to the current selection'
        );
        cat_selection.children = [];
        const cat_viewport = new TransformationCategory(
            'Viewport',
            'Transformations relevant to the current viewport'
        );
        cat_viewport.children = [];
        const cat_global = new TransformationCategory(
            'Global',
            'Transformations relevant on a global scale'
        );
        cat_global.children = [];
        const cat_uncat = new TransformationCategory(
            'Uncategorized',
            'Uncategorized Transformations'
        );
        cat_uncat.children = [];

        this.items = [cat_selection, cat_viewport, cat_global, cat_uncat];
    }

    // We don't want to mutate the set of items, categories are supposed to
    // remain constant.
    add_item(item){}

    clear_transformations(notify = true) {
        for (const cat of this.items)
            cat.children = [];
        if (notify)
            this.notify_data_changed();
    }

    set_transformations(transformations) {
        this.clear_transformations(false);

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
                this.items[i].children.push(new Transformation(
                    transformation.transformation,
                    transformation.docstring,
                    transformation.type,
                    transformation.expr_index,
                    transformation.sdfg_id,
                    transformation.state_id,
                    transformation._subgraph
                ));
            }
        }

        this.notify_data_changed();
    }

    add_uncat_transformation(transformation) {
        this.items[TransformationList.CAT_UNCATEGORIZED_IDX].add_item(
            transformation
        );
    }

}