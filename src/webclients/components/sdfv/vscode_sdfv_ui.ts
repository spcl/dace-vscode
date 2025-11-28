// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { findGraphElementByUUID } from '@spcl/sdfv/src/utils/sdfg/sdfg_utils';
import { ISDFVUserInterface } from '@spcl/sdfv/src/sdfv_ui';
import { SDFVSettings } from '@spcl/sdfv/src/utils/sdfv_settings';
import { SDFVComponent } from './vscode_sdfv';
import {
    appendDataDescriptorTable,
    appendSymbolsTable,
    generateAttributesTable,
} from './utils/attributes_table';
import {
    AccessNode,
    Edge,
    EntryNode,
    ExitNode,
    NestedSDFG,
    ScopeNode,
    SDFG,
    SDFGElement,
    SDFGRenderer,
} from '@spcl/sdfv/src';

declare let SPLIT_DIRECTION: 'vertical' | 'horizontal';

const SYMBOLS_START_EXPANDED_THRESHOLD = 10;
const DATA_CONTAINERS_START_EXPANDED_THRESHOLD = 10;

export class SDFVVSCodeUI implements ISDFVUserInterface {

    private static readonly INSTANCE: SDFVVSCodeUI = new SDFVVSCodeUI();

    private constructor() {
        return;
    }

    public static getInstance(): SDFVVSCodeUI {
        return SDFVVSCodeUI.INSTANCE;
    }

    private infoContainer?: JQuery;
    private layoutToggleBtn?: JQuery;
    private expandInfoBtn?: JQuery;
    private infoCloseBtn?: JQuery;
    private topBar?: JQuery;

    private infoDragBar?: JQuery;
    private draggingInfoBar: boolean = false;
    private infoBarLastVertWidth: number = 350;
    private infoBarLastHorHeight: number = 200;

    private infoTrayExplicitlyHidden: boolean = false;

    public get infoContentContainer(): JQuery {
        return $('#info-contents');
    }

    public registerExpandInfoButton(): void {
        this.expandInfoBtn = $('<div>', {
            id: 'expand-info-btn',
            title: 'Expand Tray',
            html: '<span><i class="material-symbols-outlined">' +
                (SPLIT_DIRECTION === 'vertical' ?
                    'right_panel_open' : 'bottom_panel_open') +
                '</i></span>',
        }).prependTo($('.button-bar-secondary'));
        this.expandInfoBtn.on('click', () => {
            this.expandInfoBtn?.hide();
            this.infoBoxCheckUncoverTopBar(this.infoContainer, this.topBar);
            this.infoContainer?.addClass('show');
            this.infoTrayExplicitlyHidden = false;
            this.checkTrayCoversMinimap(true);
        });
    }

    public init(): void {
        this.infoContainer = $('#info-container');
        this.layoutToggleBtn = $('#layout-toggle-btn');
        this.infoDragBar = $('#info-drag-bar');
        this.infoCloseBtn = $('#info-close-btn');
        this.topBar = $('#top-bar');

        // Set up resizing of the info drawer.
        this.draggingInfoBar = false;
        const infoChangeHeightHandler = (e: JQuery.MouseMoveEvent) => {
            if (this.draggingInfoBar) {
                const documentHeight = $('body').innerHeight();
                if (documentHeight) {
                    const newHeight = documentHeight - (
                        e.originalEvent?.y ?? 0
                    );
                    if (newHeight < documentHeight) {
                        this.infoBarLastHorHeight = newHeight;
                        this.infoContainer?.height(
                            this.infoBarLastHorHeight.toString() + 'px'
                        );
                    }
                }
            }
        };
        const infoChangeWidthHandler = (e: JQuery.MouseMoveEvent) => {
            if (this.draggingInfoBar) {
                const documentWidth = $('body').innerWidth();
                if (documentWidth) {
                    const newWidth = documentWidth - (e.originalEvent?.x ?? 0);
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
        this.infoDragBar.on('mousedown', () => {
            this.draggingInfoBar = true;
        });
        if (SPLIT_DIRECTION === 'vertical')
            $(document).on('mousemove', infoChangeWidthHandler);
        else
            $(document).on('mousemove', infoChangeHeightHandler);

        // Set up changing the info drawer layout.
        this.layoutToggleBtn.on('click', () => {
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

            void SDFVComponent.getInstance().invoke(
                'setSplitDirection', [SPLIT_DIRECTION]
            );
        });

        new ResizeObserver(() => {
            this.infoBoxCheckStacking(this.infoContainer);
        }).observe(this.infoContainer[0]);

        // Set up toggling the info tray.
        this.infoCloseBtn.on('click', () => {
            this.expandInfoBtn?.show();
            this.infoContainer?.removeClass('show');
            this.infoTrayExplicitlyHidden = true;
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

        if (SPLIT_DIRECTION === 'vertical') {
            this.infoContainer?.width(
                this.infoBarLastVertWidth.toString() + 'px'
            );
        } else {
            this.infoContainer?.height(
                this.infoBarLastHorHeight.toString() + 'px'
            );
        }
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
    public showElementInfo(
        elem?: SDFGElement, renderer?: SDFGRenderer
    ): void {
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

        if (elem && renderer) {
            this.infoSetTitle(elem.type + ' ' + elem.label);

            const contents = $('#info-contents');
            contents.html('');

            if (elem instanceof Edge && elem.type === 'Memlet' &&
                elem.parentStateId !== undefined) {
                const ndEdges = elem.cfg?.nodes[elem.parentStateId].edges;
                if (ndEdges) {
                    const sdfgEdge = ndEdges[elem.id];
                    $('<p>', {
                        'class': 'info-subtitle',
                        'html': 'Connectors: ' +
                            (sdfgEdge.src_connector ?? '') +
                            ' <i class="material-symbols-outlined">' +
                            'arrow_forward</i> ' +
                            (sdfgEdge.dst_connector ?? ''),
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
                const dataAttr = elem.attributes()?.data;
                if (dataAttr) {
                    const desc = elem.sdfg.attributes?._arrays[dataAttr];
                    $('<br>').appendTo(contents);
                    $('<p>', {
                        'class': 'info-subtitle',
                        'text': (desc?.type ?? '') + ' properties:',
                    }).appendTo(contents);

                    // TODO: Allow container types to be changed here too.
                    const tableContainer = $('<div>', {
                        'class': 'container-fluid attr-table-base-container',
                    }).appendTo(contents);
                    generateAttributesTable(desc, undefined, tableContainer);
                }
            } else if (elem instanceof NestedSDFG) {
                // If nested SDFG, add SDFG info too.
                const nsdfgSdfg = elem.attributes()?.sdfg;
                $('<br>').appendTo(contents);
                $('<p>', {
                    'class': 'info-subtitle',
                    'text': 'SDFG properties:',
                }).appendTo(contents);

                const tableContainer = $('<div>', {
                    'class': 'container-fluid attr-table-base-container',
                }).appendTo(contents);
                generateAttributesTable(nsdfgSdfg, undefined, tableContainer);
                const nSdfgAttrs = nsdfgSdfg?.attributes;
                if (nSdfgAttrs) {
                    appendDataDescriptorTable(
                        contents, nSdfgAttrs._arrays, nsdfgSdfg,
                        DATA_CONTAINERS_START_EXPANDED_THRESHOLD
                    );
                    appendSymbolsTable(
                        contents, nSdfgAttrs.symbols,
                        SYMBOLS_START_EXPANDED_THRESHOLD
                    );
                }
            } else if (elem instanceof ScopeNode) {
                // If we're processing a scope node, we want to append the exit
                // node's props when selecting an entry node, and vice versa.
                let otherElem = undefined;

                let otherUuid = undefined;
                if (elem instanceof EntryNode &&
                    !elem.attributes()?.is_collapsed) {
                    otherUuid = elem.cfg!.cfg_list_id.toString() + '/' +
                        (elem.parentStateId ?? -1).toString() + '/' +
                        (elem.jsonData?.scope_exit ?? -1).toString() + '/-1';
                } else if (elem instanceof ExitNode) {
                    otherUuid = elem.cfg!.cfg_list_id.toString() + '/' +
                        (elem.parentStateId ?? -1).toString() + '/' +
                        (elem.jsonData?.scope_entry ?? -1).toString() + '/-1';
                }

                if (otherUuid) {
                    otherElem = findGraphElementByUUID(
                        renderer.cfgList, otherUuid
                    );
                }

                if (otherElem && otherElem instanceof SDFGElement) {
                    $('<br>').appendTo(contents);
                    $('<p>', {
                        'class': 'info-subtitle',
                        'text': otherElem.type + ' ' + otherElem.label,
                    }).appendTo(contents);

                    const tableContainer = $('<div>', {
                        'class': 'container-fluid attr-table-base-container',
                    }).appendTo(contents);
                    generateAttributesTable(
                        otherElem, undefined, tableContainer
                    );
                }
            } else if (elem instanceof SDFG) {
                const attrs = elem.attributes();
                if (attrs && elem.jsonData) {
                    appendDataDescriptorTable(
                        contents, attrs._arrays, elem.jsonData,
                        DATA_CONTAINERS_START_EXPANDED_THRESHOLD
                    );
                    appendSymbolsTable(
                        contents, attrs.symbols,
                        SYMBOLS_START_EXPANDED_THRESHOLD
                    );
                }
            }

            this.infoBoxCheckStacking($('#info-container'));
        } else {
            this.infoClear();
        }

        this.infoShow();
    }

    private infoBoxCheckUncoverTopBar(
        infoContainer?: JQuery, topBar?: JQuery
    ): void {
        // If the info container is to the side, ensure it doesn't cover up the
        // top bar when shown.
        if (infoContainer?.hasClass('offcanvas-end')) {
            const topBarHeight = topBar?.outerHeight(false) ?? 0;
            infoContainer.css('top', topBarHeight.toString() + 'px');
        } else {
            infoContainer?.css('top', '');
        }
    }

    /**
     * Check if the info box is wide enough to show keys / values side-by-side.
     * If not, stack them one on top of the other.
     * @param infoContainer The info box container.
     */
    private infoBoxCheckStacking(infoContainer?: JQuery): void {
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
                    if (animate) {
                        $('#minimap').css(
                            'transition', 'right 0.3s ease-in-out'
                        );
                    } else {
                        $('#minimap').css('transition', '');
                    }
                    $('#minimap').css('right', pixels.toString() + 'px');
                } catch (e) {
                    console.warn(e);
                }
            } else {
                if (animate) {
                    $('#minimap').css(
                        'transition', 'right 0.3s ease-in-out'
                    );
                } else {
                    $('#minimap').css('transition', '');
                }
                $('#minimap').css('right', '5px');
            }
        }
    }

    public async showActivityIndicatorFor<T>(
        message: string, fun: (...args: unknown[]) => Promise<T>
    ): Promise<T> {
        const sdfvComponent = SDFVComponent.getInstance();
        const uuid = await sdfvComponent.invoke<string>(
            'showActivity', [message]
        );
        const ret = await fun();
        await sdfvComponent.invoke('hideActivity', [uuid]);
        return ret;
    }

}
