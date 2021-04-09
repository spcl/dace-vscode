// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class TreeViewItem {

    constructor(label, tooltip, icon, init_collapsed, unfold_dblclick,
                label_style = undefined, icon_style = undefined) {
        this.label = label;
        this.tooltip = tooltip;
        this.icon = icon;
        this.collapsed = init_collapsed;
        this.unfold_dblclick = unfold_dblclick;
        // Parent item, undefined if directly under list root.
        this.parent_item = undefined;
        this.children = undefined;

        this.label_style = label_style;
        this.icon_style = icon_style;

        this.element = undefined;
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

        let label = undefined;
        // If this element has children, draw it as a nested list.
        if (this.children !== undefined) {
            const nested_label = $('<span>', {
                'class': 'tree-view-item-label tree-view-item-label-nested',
            });
            label_container.append(nested_label);

            const nested_list = $('<ul>', {
                'class': 'tree-view-list',
            });

            this.children.forEach(child => {
                nested_list.append(child.generate_html());
            });

            if (this.unfold_dblclick) {
                nested_label.dblclick((event) => {
                    nested_list.toggle();
                    nested_label.toggleClass('tree-view-expanded');
                    this.collapsed = !this.collapsed;

                    event.stopPropagation();
                });
            } else {
                nested_label.click((event) => {
                    nested_list.toggle();
                    nested_label.toggleClass('tree-view-expanded');
                    this.collapsed = !this.collapsed;

                    event.stopPropagation();
                });
            }

            if (!this.collapsed)
                nested_label.addClass('tree-view-expanded');

            item.append(nested_list);

            label = nested_label;
        } else {
            label = $('<span>', {
                'class': 'tree-view-item-label',
            });
            label_container.append(label);
        }

        const label_text = $('<span>', {
            'text': this.label,
        });
        if (this.icon !== undefined && this.icon !== '') {
            let icon_elem;
            if (this.icon.startsWith('res:') && csp_src !== undefined)
                icon_elem = $('<img>', {
                    'class': 'tree-view-item-icon',
                    'style': 'height: 1rem; width: 1rem;',
                    'src': csp_src + '/resources/' + this.icon.substr(4),
                }).appendTo(label);
            else
                icon_elem = $('<i>', {
                    'class': 'material-icons tree-view-item-icon',
                    'style': 'font-size: inherit;',
                    'text': this.icon,
                }).appendTo(label);

            if (this.icon_style !== undefined && this.icon_style !== '')
                icon_elem.attr(
                    'style',
                    icon_elem.attr('style') + ';' + this.icon_style
                );

            label.append("&nbsp;");
        }

        label.append(label_text);
        if (this.label_style !== undefined && this.label_style !== '')
            label_text.attr(
                'style',
                label_text.attr('style') + ';' + this.label_style
            );

        this.element = item;
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

    clear() {
        this.items = [];
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