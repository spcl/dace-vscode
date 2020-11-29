class OutlineItem extends TreeViewItem {

    constructor(icon, type, label, collapsed, element_uuid) {
        let item_label = label;
        if (collapsed)
            item_label += ' (collapsed)';
        let label_style = '';
        if (type === 'SDFG')
            label_style = 'font-size: 1.1rem; font-style: italic;';
        super(item_label, type, icon, false, true, label_style,
              'color: var(--vscode-gitDecoration-addedResourceForeground);');

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