// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    AccessNode,
    Edge,
    EntryNode,
    ExitNode,
    findGraphElementByUUID,
    ISDFVUserInterface,
    NestedSDFG,
    ScopeNode,
    SDFG,
    SDFGElement,
    SDFGRenderer,
    SDFVSettings,
} from '@spcl/sdfv/src';
import { SDFVComponent, VSCodeSDFV } from './vscode_sdfv';
import {
    appendDataDescriptorTable,
    appendSymbolsTable,
    generateAttributesTable,
} from './utils/attributes_table';

declare let SPLIT_DIRECTION: 'vertical' | 'horizontal';

export class SDFVVSCodeUI implements ISDFVUserInterface {

    private static readonly INSTANCE: SDFVVSCodeUI = new SDFVVSCodeUI();

    private constructor() {
    }

    public static getInstance(): SDFVVSCodeUI {
        return this.INSTANCE;
    }

    private infoContainer?: JQuery<HTMLElement>;
    private layoutToggleBtn?: JQuery<HTMLElement>;
    private expandInfoBtn?: JQuery<HTMLElement>;
    private infoCloseBtn?: JQuery<HTMLElement>;
    private topBar?: JQuery<HTMLElement>;

    private infoDragBar?: JQuery<HTMLElement>;
    private draggingInfoBar: boolean = false;
    private infoBarLastVertWidth: number = 350;
    private infoBarLastHorHeight: number = 200;

    private infoTrayExplicitlyHidden: boolean = false;

    public get infoContentContainer(): JQuery<HTMLElement> {
        return $('#info-contents');
    }

    public init(): void {
        this.infoContainer = $('#info-container');
        this.layoutToggleBtn = $('#layout-toggle-btn');
        this.infoDragBar = $('#info-drag-bar');
        this.expandInfoBtn = $('#expand-info-btn');
        this.infoCloseBtn = $('#info-close-btn');
        this.topBar = $('#top-bar');

        // Set up resizing of the info drawer.
        this.draggingInfoBar = false;
        const infoChangeHeightHandler = (e: any) => {
            if (this.draggingInfoBar) {
                const documentHeight = $('body').innerHeight();
                if (documentHeight) {
                    const newHeight = documentHeight - e.originalEvent.y;
                    if (newHeight < documentHeight) {
                        this.infoBarLastHorHeight = newHeight;
                        this.infoContainer?.height(
                            this.infoBarLastHorHeight.toString() + 'px'
                        );
                    }
                }
            }
        };
        const infoChangeWidthHandler = (e: any) => {
            if (this.draggingInfoBar) {
                const documentWidth = $('body').innerWidth();
                if (documentWidth) {
                    const newWidth = documentWidth - e.originalEvent.x;
                    if (newWidth < documentWidth) {
                        this.infoBarLastVertWidth = newWidth;
                        this.infoContainer?.width(newWidth.toString() + 'px');

                        if (SDFVSettings.get<boolean>('minimap')) {
                            $('#minimap').css('transition', '');
                            $('#minimap').css(
                                'right', (newWidth + 5).toString() + 'px'
                            );
                        }
                    }
                }
            }
        };
        $(document).on('mouseup', () => {
            this.draggingInfoBar = false;
        });
        this.infoDragBar?.on('mousedown', () => {
            this.draggingInfoBar = true;
        });
        if (SPLIT_DIRECTION === 'vertical')
            $(document).on('mousemove', infoChangeWidthHandler);
        else
            $(document).on('mousemove', infoChangeHeightHandler);

        // Set up changing the info drawer layout.
        this.layoutToggleBtn?.on('click', () => {
            const oldDir = SPLIT_DIRECTION;
            SPLIT_DIRECTION = SPLIT_DIRECTION === 'vertical' ?
                'horizontal' : 'vertical';
            this.layoutToggleBtn?.removeClass(oldDir);
            this.layoutToggleBtn?.addClass(SPLIT_DIRECTION);
            if (oldDir === 'vertical') {
                this.infoContainer?.removeClass('offcanvas-end');
                this.infoContainer?.addClass('offcanvas-bottom');
                this.infoDragBar?.removeClass('gutter-vertical');
                this.infoDragBar?.addClass('gutter-horizontal');
                this.expandInfoBtn?.html(
                    '<span><i class="material-symbols-outlined">' +
                        'bottom_panel_open</i></span>'
                );
                $(document).off('mousemove', infoChangeWidthHandler);
                $(document).on('mousemove', infoChangeHeightHandler);
                this.infoContainer?.width('100%');
                this.infoContainer?.height(
                    this.infoBarLastHorHeight.toString() + 'px'
                );
            } else {
                this.infoContainer?.removeClass('offcanvas-bottom');
                this.infoContainer?.addClass('offcanvas-end');
                this.infoDragBar?.removeClass('gutter-horizontal');
                this.infoDragBar?.addClass('gutter-vertical');
                this.expandInfoBtn?.html(
                    '<span><i class="material-symbols-outlined">' +
                        'right_panel_open</i></span>'
                );
                $(document).off('mousemove', infoChangeHeightHandler);
                $(document).on('mousemove', infoChangeWidthHandler);
                this.infoContainer?.height('100%');
                this.infoContainer?.width(
                    this.infoBarLastVertWidth.toString() + 'px'
                );
            }

            this.infoBoxCheckStacking(this.infoContainer);
            this.infoBoxCheckUncoverTopBar(this.infoContainer, this.topBar);
            this.checkTrayCoversMinimap();

            SDFVComponent.getInstance().invoke(
                'setSplitDirection', [SPLIT_DIRECTION]
            );
        });

        if (this.infoContainer)
            new ResizeObserver(() => {
                this.infoBoxCheckStacking(this.infoContainer);
            }).observe(this.infoContainer[0]);

        // Set up toggling the info tray.
        this.infoCloseBtn?.on('click', () => {
            this.expandInfoBtn?.show();
            this.infoContainer?.removeClass('show');
            this.infoTrayExplicitlyHidden = true;
            this.checkTrayCoversMinimap(true);
        });
        this.expandInfoBtn?.on('click', () => {
            this.expandInfoBtn?.hide();
            this.infoBoxCheckUncoverTopBar(this.infoContainer, this.topBar);
            this.infoContainer?.addClass('show');
            this.infoTrayExplicitlyHidden = false;
            this.checkTrayCoversMinimap(true);
        });
    }

    public infoClear(hide: boolean = false): void {
        $('#info-contents').html('');
        $('#info-title').text('');
        $('#goto-source-btn').hide();
        $('#goto-cpp-btn').hide();
        $('#goto-edge-start').hide();
        $('#goto-edge-end').hide();
        if (hide)
            this.infoHide();
    }

    public infoShow(overrideHidden: boolean = false): void {
        if (!this.infoTrayExplicitlyHidden || overrideHidden) {
            const infoBox = $('#info-container');
            this.infoBoxCheckUncoverTopBar(infoBox, $('#top-bar'));
            infoBox.addClass('show');
            this.checkTrayCoversMinimap(true);
        }

        if (SPLIT_DIRECTION === 'vertical')
            this.infoContainer?.width(
                this.infoBarLastVertWidth.toString() + 'px'
            );
        else
            this.infoContainer?.height(
                this.infoBarLastHorHeight.toString() + 'px'
            );
    }

    public infoHide(): void {
        $('#info-container').removeClass('show');
    }

    public infoSetTitle(title: string): void {
        $('#info-title').text(title);
    }

    public disableInfoClear(): void {
        throw new Error('Method not implemented.');
    }

    public enableInfoClear(): void {
        throw new Error('Method not implemented.');
    }

    /**
     * Fill out the info-box of the embedded layout with info about an element.
     * This dynamically builds one or more tables showing all of the relevant
     * info about a given element.
     */
    public showElementInfo(elem: SDFGElement, renderer: SDFGRenderer): void {
        const buttons = [
            $('#goto-source-btn'),
            $('#goto-cpp-btn'),
            $('#goto-edge-start'),
            $('#goto-edge-end'),
        ];

        // Clear and hide these buttons.
        buttons.forEach((btn) => {
            btn.hide();
            btn.off('click');
            btn.prop('title', '');
        });

        if (elem) {
            this.infoSetTitle(elem.type() + ' ' + elem.label());

            const contents = $('#info-contents');
            contents.html('');

            if (elem instanceof Edge && elem.data.type === 'Memlet' &&
                elem.parent_id !== null) {
                const ndEdges = elem.cfg?.nodes[elem.parent_id].edges;
                if (ndEdges) {
                    let sdfg_edge = ndEdges[elem.id];
                    $('<p>', {
                        'class': 'info-subtitle',
                        'html': 'Connectors: ' + sdfg_edge.src_connector +
                            ' <i class="material-symbols-outlined">' +
                            'arrow_forward</i> ' + sdfg_edge.dst_connector,
                    }).appendTo(contents);
                    $('<hr>').appendTo(contents);
                }
            }

            const tableContainer = $('<div>', {
                'class': 'container-fluid attr-table-base-container',
            }).appendTo(contents);
            generateAttributesTable(elem, undefined, tableContainer);

            if (elem instanceof AccessNode) {
                // If we're processing an access node, add array info too.
                const sdfg_array = elem.sdfg.attributes._arrays[
                    elem.attributes().data
                ];
                $('<br>').appendTo(contents);
                $('<p>', {
                    'class': 'info-subtitle',
                    'text': sdfg_array.type + ' properties:',
                }).appendTo(contents);

                // TODO: Allow container types to be changed here too.
                const tableContainer = $('<div>', {
                    'class': 'container-fluid attr-table-base-container',
                }).appendTo(contents);
                generateAttributesTable(sdfg_array, undefined, tableContainer);
            } else if (elem instanceof NestedSDFG) {
                // If nested SDFG, add SDFG info too.
                const sdfg_sdfg = elem.attributes().sdfg;
                $('<br>').appendTo(contents);
                $('<p>', {
                    'class': 'info-subtitle',
                    'text': 'SDFG properties:',
                }).appendTo(contents);

                const tableContainer = $('<div>', {
                    'class': 'container-fluid attr-table-base-container',
                }).appendTo(contents);
                generateAttributesTable(sdfg_sdfg, undefined, tableContainer);
            } else if (elem instanceof ScopeNode) {
                // If we're processing a scope node, we want to append the exit
                // node's props when selecting an entry node, and vice versa.
                let other_element = undefined;

                let other_uuid = undefined;
                if (elem instanceof EntryNode &&
                    !elem.attributes().is_collapsed) {
                    other_uuid = elem.cfg!.cfg_list_id + '/' +
                        elem.parent_id + '/' +
                        elem.data.node.scope_exit + '/-1';
                } else if (elem instanceof ExitNode) {
                    other_uuid = elem.cfg!.cfg_list_id + '/' +
                        elem.parent_id + '/' +
                        elem.data.node.scope_entry + '/-1';
                }

                if (other_uuid) {
                    other_element = findGraphElementByUUID(
                        renderer.getCFGList(), other_uuid
                    );
                }

                if (other_element && other_element instanceof SDFGElement) {
                    $('<br>').appendTo(contents);
                    $('<p>', {
                        'class': 'info-subtitle',
                        'text':
                            other_element.type() + ' ' + other_element.label(),
                    }).appendTo(contents);

                    const tableContainer = $('<div>', {
                        'class': 'container-fluid attr-table-base-container',
                    }).appendTo(contents);
                    generateAttributesTable(
                        other_element, undefined, tableContainer
                    );
                }
            } else if (elem instanceof SDFG) {
                if (elem.data?.attributes) {
                    appendDataDescriptorTable(
                        contents, elem.data.attributes._arrays, elem.data
                    );
                    appendSymbolsTable(
                        contents, elem.data.attributes.symbols, elem.data
                    );
                }
            } else if (elem instanceof NestedSDFG) {
                if (elem.data?.node?.attributes) {
                    appendDataDescriptorTable(
                        contents,
                        elem.data.node.attributes.sdfg.attributes._arrays,
                        elem.data.node.attributes.sdfg
                    );
                    appendSymbolsTable(
                        contents,
                        elem.data.node.attributes.sdfg.attributes.symbols,
                        elem.data.node.attributes.sdfg
                    );
                }
            }

            this.infoBoxCheckStacking($('#info-container'));
        } else {
            this.infoClear();
        }
    }

    private infoBoxCheckUncoverTopBar(
        infoContainer?: JQuery<HTMLElement>, topBar?: JQuery<HTMLElement>
    ): void {
        // If the info container is to the side, ensure it doesn't cover up the
        // top bar when shown.
        if (infoContainer?.hasClass('offcanvas-end')) {
            const topBarHeight = topBar?.outerHeight(false);
            infoContainer?.css('top', topBarHeight + 'px');
        } else {
            infoContainer?.css('top', '');
        }
    }

    /**
     * Check if the info box is wide enough to show keys / values side-by-side.
     * If not, stack them one on top of the other.
     * @param infoContainer The info box container.
     */
    private infoBoxCheckStacking(infoContainer?: JQuery<HTMLElement>): void {
        const innerWidth = infoContainer?.innerWidth();
        if (innerWidth && innerWidth <= 575)
            infoContainer?.addClass('stacked');
        else
            infoContainer?.removeClass('stacked');
    }

    private checkTrayCoversMinimap(animate: boolean = false): void {
        if (SDFVSettings.get<boolean>('minimap')) {
            if (SPLIT_DIRECTION === 'vertical' && this.infoBarLastVertWidth &&
                !this.infoTrayExplicitlyHidden) {
                try {
                    const pixels = this.infoBarLastVertWidth + 5;
                    if (animate)
                        $('#minimap').css(
                            'transition', 'right 0.3s ease-in-out'
                        );
                    else
                        $('#minimap').css('transition', '');
                    $('#minimap').css('right', pixels.toString() + 'px');
                } catch (e) {
                    console.warn(e);
                }
            } else {
                if (animate)
                    $('#minimap').css(
                        'transition', 'right 0.3s ease-in-out'
                    );
                else
                    $('#minimap').css('transition', '');
                $('#minimap').css('right', '5px');
            }
        }
    }

}
