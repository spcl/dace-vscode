// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

export class CustomTreeViewItem {

    public parentItem: CustomTreeViewItem | undefined = undefined;
    public children: CustomTreeViewItem[] | undefined = undefined;
    public list: CustomTreeView | undefined = undefined;
    public element: any = undefined;

    public constructor(
        private label: string,
        private tooltip: string | undefined,
        private icon: string | undefined,
        private collapsed: boolean,
        private unfoldDoubleClick: boolean,
        private labelStyle: string | undefined = undefined,
        private iconStyle: string | undefined = undefined,
        private readonly MEDIA_DIR: string | undefined = undefined
    ) {
    }

    public addItem(child: CustomTreeViewItem): void {
        if (this.children === undefined)
            this.children = [];
        this.children.push(child);
        child.parentItem = this;
        child.list = this.list;
    }

    public generateHtml(): JQuery {
        const item = $('<li>', {
            'class': 'tree-view-item',
            'mouseover': (event: MouseEvent) => {
                item.addClass('hover');
                event.stopPropagation();
            },
            'mouseout': (event: MouseEvent) => {
                item.removeClass('hover');
                event.stopPropagation();
            },
        });

        const labelContainer = $('<div>', {
            'class': 'tree-view-item-label-container',
            'title': this.tooltip,
        });
        item.append(labelContainer);

        let label = undefined;
        // If this element has children, draw it as a nested list.
        if (this.children !== undefined) {
            const nestedLabel = $('<span>', {
                'class': 'tree-view-item-label tree-view-item-label-nested',
            });
            labelContainer.append(nestedLabel);

            const nestedList = $('<ul>', {
                'class': 'tree-view-list',
            });

            if (!this.collapsed)
                this.children.forEach(child => {
                    nestedList.append(child.generateHtml());
                });

            if (this.unfoldDoubleClick) {
                nestedLabel.on('dblclick', (event) => {
                    nestedList.toggle();
                    nestedLabel.toggleClass('tree-view-expanded');
                    this.collapsed = !this.collapsed;

                    if (this.list)
                        this.list.notifyDataChanged();

                    event.stopPropagation();
                });
            } else {
                nestedLabel.on('click', (event) => {
                    nestedList.toggle();
                    nestedLabel.toggleClass('tree-view-expanded');
                    this.collapsed = !this.collapsed;

                    if (this.list)
                        this.list.notifyDataChanged();

                    event.stopPropagation();
                });
            }

            if (!this.collapsed)
                nestedLabel.addClass('tree-view-expanded');

            item.append(nestedList);

            label = nestedLabel;
        } else {
            label = $('<span>', {
                'class': 'tree-view-item-label',
            });
            labelContainer.append(label);
        }

        // Add children count to label if exists
        let extra = '';
        if (this.children)
            extra = ' (' + this.children.length + ')';

        const labelText = $('<span>', {
            'text': this.label + extra,
        });
        if (this.icon !== undefined && this.icon !== '') {
            let iconElement;
            if (this.icon.startsWith('res:') && this.MEDIA_DIR !== undefined)
                iconElement = $('<img>', {
                    'class': 'tree-view-item-icon',
                    'style': 'height: 1rem; width: 1rem;',
                    'src': this.MEDIA_DIR + '/resources/' + this.icon.substr(4),
                }).appendTo(label);
            else
                iconElement = $('<i>', {
                    'class': 'material-icons tree-view-item-icon',
                    'style': 'font-size: inherit;',
                    'text': this.icon,
                }).appendTo(label);

            if (this.iconStyle !== undefined && this.iconStyle !== '')
                iconElement.attr(
                    'style',
                    iconElement.attr('style') + ';' + this.iconStyle
                );

            label.append('&nbsp;');
        }

        label.append(labelText);
        if (this.labelStyle !== undefined && this.labelStyle !== '')
            labelText.attr(
                'style',
                labelText.attr('style') + ';' + this.labelStyle
            );

        this.element = item;
        return item;
    }

}

export class CustomTreeView {

    protected items: CustomTreeViewItem[] = [];
    public selectedItem: CustomTreeViewItem | undefined = undefined;

    public constructor(
        protected rootElement: JQuery
    ){}

    public addItem(item: CustomTreeViewItem): void {
        this.items.push(item);
        item.parentItem = undefined;
        item.list = this;
    }

    public clear(): void {
        this.items = [];
    }

    public hide(): void {
        this.rootElement.hide();
    }

    public show(): void {
        this.rootElement.show();
    }

    public generateHtml(): void {
        if (this.items && this.items.length) {
            const list = $('<ul>', {
                'class': 'tree-view-list',
            });

            // Generate each item's HTML and add it to the list.
            this.items.forEach(item => {
                list.append(item.generateHtml());
            });

            // Clear the current list and set the content to the new one.
            this.rootElement.empty();
            this.rootElement.append(list);
        } else {
            this.rootElement.empty();
        }
    }

    public notifyDataChanged(): void {
        this.generateHtml();
    }

}