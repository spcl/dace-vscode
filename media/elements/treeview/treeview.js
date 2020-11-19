class TreeViewItem {

    constructor(label, tooltip) {
        this.label = label;
        this.tooltip = tooltip;
        // Parent item, undefined if directly under list root.
        this.parent_item = undefined;
        this.children = undefined;
    }

    add_item(child) {
        if (this.children === undefined)
            this.children = [];
        this.children.push(child);
        child.parent_item = this;
    }

    generate_html() {
        const item = $('<li>', {
            'class': 'tree-view-item',
            'mouseover': (event) => {
                item.addClass('hover');
                event.stopPropagation();
            },
            'mouseout': (event) => {
                item.removeClass('hover');
                event.stopPropagation();
            },
        });

        const label_container = $('<div>', {
            'class': 'tree-view-item-label-container',
            'title': this.tooltip,
        });
        item.append(label_container);

        // If this element has children, draw it as a nested list.
        if (this.children !== undefined) {
            const nested_label = $('<span>', {
                'class': 'tree-view-item-label tree-view-item-label-nested tree-view-expanded',
                'text': this.label,
            });
            label_container.append(nested_label);

            const nested_list = $('<ul>', {
                'class': 'tree-view-list',
            });

            this.children.forEach(child => {
                nested_list.append(child.generate_html());
            });

            nested_label.click((event) => {
                nested_list.toggle();
                nested_label.toggleClass('tree-view-expanded');

                event.stopPropagation();
            });

            item.append(nested_list);
        } else {
            const label = $('<span>', {
                'class': 'tree-view-item-label',
                'text': this.label,
            });
            label_container.append(label);
        }

        return item;
    }

}

class TreeView {

    constructor(root_element) {
        this.root_element = root_element;
        this.items = [];
    }

    add_item(item) {
        this.items.push(item);
        item.parent_item = undefined;
    }

    hide() {
        this.root_element.hide();
    }

    show() {
        this.root_element.show();
    }

    generate_html() {
        if (this.items && this.items.length) {
            const list = $('<ul>', {
                'class': 'tree-view-list',
            });

            // Generate each item's HTML and add it to the list.
            this.items.forEach(item => {
                list.append(item.generate_html());
            });

            // Clear the current list and set the content to the new one.
            this.root_element.empty();
            this.root_element.append(list);
        } else {
            this.root_element.empty();
        }
    }

    notify_data_changed() {
        this.generate_html();
    }

}