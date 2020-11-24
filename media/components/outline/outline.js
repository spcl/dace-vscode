class OutlineItem extends TreeViewItem {

    constructor(icon, type, label, tooltip, element_uuid) {
        let item_label = label;
        if (type !== undefined && type !== '')
            item_label = type + ' ' + item_label;

        super(item_label, tooltip, icon, false, true);

        this.element_uuid = element_uuid;
    }

    generate_html() {
        const item = super.generate_html();

        item.click((e) => {
            if (vscode)
                vscode.postMessage({
                    type: 'sdfv.zoom_to_node',
                    uuid: this.element_uuid,
                });
            e.stopPropagation();
        });

        item.mouseover(() => {
            if (vscode)
                vscode.postMessage({
                    type: 'sdfv.highlight_elements',
                    elements: [this.element_uuid],
                });
        });

        return item;
    }

}

class OutlineList extends TreeView {

    constructor(root_element) {
        super(root_element);
    }

}