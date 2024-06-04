// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import $ from 'jquery';
(window as any).jQuery = $;

// JQuery Plugin to allow for editable selects.
import 'jquery-editable-select';
import 'jquery-editable-select/dist/jquery-editable-select.min.css';

import 'bootstrap';

import '@spcl/sdfv/scss/sdfv.scss';

import './vscode_sdfv.scss';

import * as staticSdfgMetaDict from '../../../utils/sdfg_meta_dict.json';

import {
    AccessNode,
    DagreGraph,
    Edge,
    EntryNode,
    ExitNode,
    findGraphElementByUUID,
    find_in_graph,
    GenericSdfgOverlay,
    getGraphElementUUID,
    JsonSDFG,
    LogicalGroup,
    LogicalGroupOverlay,
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    mouse_event,
    NestedSDFG,
    OperationalIntensityOverlay,
    SimulatedOperationalIntensityOverlay,
    parse_sdfg,
    Point2D,
    read_or_decompress,
    RuntimeMicroSecondsOverlay,
    ScopeNode,
    SDFG,
    SDFGElement,
    SDFGRenderer,
    SDFV,
    State,
    StaticFlopsOverlay,
    DepthOverlay,
    AvgParallelismOverlay,
    SymbolMap,
    traverseSDFGScopes,
    JsonSDFGState,
    checkCompatLoad,
    find_in_graph_predicate,
} from '@spcl/sdfv/src';
import { LViewRenderer } from '@spcl/sdfv/src/local_view/lview_renderer';
import {
    SDFVSettingKey,
    SDFVSettingValT,
    SDFVSettings,
} from '@spcl/sdfv/src/utils/sdfv_settings';
import {
    ICPCRequest
} from '../../../common/messaging/icpc_messaging_component';
import {
    ICPCWebclientMessagingComponent
} from '../../messaging/icpc_webclient_messaging_component';
import {
    JsonTransformation,
    JsonTransformationList
} from '../transformations/transformations';
import { AnalysisController } from './analysis/analysis_controller';
import {
    BreakpointIndicator,
    refreshBreakpoints
} from './breakpoints/breakpoints';
import { VSCodeRenderer } from './renderer/vscode_renderer';
import {
    clearSelectedTransformation,
    refreshTransformationList,
    refreshXform,
    showTransformationDetails
} from './transformation/transformation';
import {
    appendDataDescriptorTable,
    appendSymbolsTable,
    generateAttributesTable
} from './utils/attributes_table';
import {
    findJsonSDFGElementByUUID,
    highlightUUIDs,
    isCollapsible,
    jsonSDFGElemReadAttr,
    reselectRendererElement,
    showContextMenu,
    unGraphiphySdfg,
    vscodeWriteGraph,
    zoomToUUIDs
} from './utils/helpers';
import { ComponentTarget } from '../../../components/components';
import { gzipSync } from 'zlib';

declare const vscode: any;
declare let SPLIT_DIRECTION: 'vertical' | 'horizontal';

export class VSCodeSDFV extends SDFV {

    public static readonly DEBUG_DRAW: boolean = false;

    private static readonly INSTANCE: VSCodeSDFV = new VSCodeSDFV();

    private constructor() {
        super();
    }

    public static getInstance(): VSCodeSDFV {
        return this.INSTANCE;
    }

    public static readonly OVERLAYS: {
        [key: string]: typeof GenericSdfgOverlay,
    } = {
            'MemoryVolumeOverlay': MemoryVolumeOverlay,
            'StaticFlopsOverlay': StaticFlopsOverlay,
            'DepthOverlay': DepthOverlay,
            'AvgParallelismOverlay': AvgParallelismOverlay,
            'RuntimeMicroSecondsOverlay': RuntimeMicroSecondsOverlay,
            'BreakpointIndicator': BreakpointIndicator,
            'MemoryLocationOverlay': MemoryLocationOverlay,
            'OperationalIntensityOverlay': OperationalIntensityOverlay,
            'SimulatedOperationalIntensityOverlay': SimulatedOperationalIntensityOverlay,
            'LogicalGroupOverlay': LogicalGroupOverlay,
        };

    private processingOverlay?: JQuery<HTMLElement>;
    private processingOverlayMsg?: JQuery<HTMLElement>;
    private infoContainer?: JQuery<HTMLElement>;
    private layoutToggleBtn?: JQuery<HTMLElement>;
    private expandInfoBtn?: JQuery<HTMLElement>;
    private infoCloseBtn?: JQuery<HTMLElement>;
    private topBar?: JQuery<HTMLElement>;

    private infoDragBar?: JQuery<HTMLElement>;
    private draggingInfoBar: boolean = false;
    private infoBarLastVertWidth: number = 350;
    private infoBarLastHorHeight: number = 200;

    private monaco: any | null = null;
    private origSDFG: JsonSDFG | null = null;
    private sdfgMetaDict: { [key: string]: any } | null = null;
    private queryMetaDictFunc: Promise<Record<string, any>> | null= null;
    private viewingHistoryState: boolean = false;
    private viewingHistoryIndex: number | undefined = undefined;
    private viewingCompressed: boolean = false;
    private showingBreakpoints: boolean = false;
    private daemonConnected: boolean = false;
    private transformations: JsonTransformationList = {
        selection: [],
        viewport: [],
        passes: [],
        uncategorized: [],
    };
    private selectedTransformation: JsonTransformation | null = null;

    public infoTrayExplicitlyHidden: boolean = false;

    public initialize(): void {
        this.initDOM();
        this.initInfoBox();
        this.initSearch();

        this.refreshSdfg().then(() => {
            this.processingOverlay?.hide();
            SDFVComponent.getInstance().invoke('onReady');
        });
    }

    private initDOM(): void {
        this.processingOverlay = $('#processing-overlay');
        this.processingOverlayMsg = $('#processing-overlay-msg');

        this.infoContainer = $('#info-container');
        this.layoutToggleBtn = $('#layout-toggle-btn');
        this.infoDragBar = $('#info-drag-bar');
        this.expandInfoBtn = $('#expand-info-btn');
        this.infoCloseBtn = $('#info-close-btn');
        this.topBar = $('#top-bar');
    }

    private initInfoBox(): void {
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

            infoBoxCheckStacking(this.infoContainer);
            infoBoxCheckUncoverTopBar(this.infoContainer, this.topBar);
            this.checkTrayCoversMinimap();

            SDFVComponent.getInstance().invoke(
                'setSplitDirection', [SPLIT_DIRECTION]
            );
        });

        if (this.infoContainer)
            new ResizeObserver(() => {
                infoBoxCheckStacking(this.infoContainer);
            }).observe(this.infoContainer[0]);

        // Set up toggling the info tray.
        this.infoCloseBtn?.on('click', () => {
            this.expandInfoBtn?.show();
            this.infoContainer?.removeClass('show');
            VSCodeSDFV.getInstance().infoTrayExplicitlyHidden = true;
            this.checkTrayCoversMinimap(true);
        });
        this.expandInfoBtn?.on('click', () => {
            this.expandInfoBtn?.hide();
            infoBoxCheckUncoverTopBar(this.infoContainer, this.topBar);
            this.infoContainer?.addClass('show');
            VSCodeSDFV.getInstance().infoTrayExplicitlyHidden = false;
            this.checkTrayCoversMinimap(true);
        });
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

    public initSearch(): void {
        const caseBtn = $('#search-case');
        const whileTypingBtn = $('#search-while-typing');
        const searchInput = $('#search');

        caseBtn.on('change', () => {
            VSCodeSDFV.getInstance().startFindInGraph();
        });

        searchInput.on('input', () => {
            VSCodeSDFV.getInstance().startFindInGraph();
        });

        // Start search whenever text is entered in the search bar.
        whileTypingBtn.on('change', () => {
            searchInput.off('input');
            if (whileTypingBtn.is(':checked')) {
                searchInput.on('input', () => {
                    VSCodeSDFV.getInstance().startFindInGraph();
                });
            }
        });

        // Start search on enter press in the search bar.
        searchInput.on('keydown', (e) => {
            if (e.key === 'Enter')
                VSCodeSDFV.getInstance().startFindInGraph();
        });

        const searchBtn = $('#search-btn');
        searchBtn.off('click');
        searchBtn.on('click', () => {
            VSCodeSDFV.getInstance().startFindInGraph();
        });

        const advSearchBtn = $('#advsearch-btn');
        advSearchBtn.off('click');
        advSearchBtn.on('click', (e) => {
            e.preventDefault();
            const renderer = VSCodeRenderer.getInstance();
            if (renderer) {
                setTimeout(() => {
                    const graph = renderer.get_graph();
                    const code = $('#advsearch').val();
                    if (graph && code) {
                        const predicate = eval(code.toString());
                        find_in_graph_predicate(
                            this, renderer, graph, predicate
                        );
                    }
                }, 1);
            }
            return false;
        });
    }

    public init_menu(): void {
        this.initInfoBox();
    }

    public close_menu(): void {
        this.clearInfoBox();
    }

    public sidebar_get_contents(): HTMLElement | null {
        return this.infoBoxGetContents();
    }

    public sidebar_show(): void {
        this.infoBoxShow();
    }

    public sidebar_set_title(title: string): void {
        this.infoBoxSetTitle(title);
    }

    public fill_info(elem: SDFGElement): void {
        this.fillInfo(elem);
    }

    public start_find_in_graph(): void {
        this.startFindInGraph();
    }

    /**
     * Get the current info-box contents.
     */
    public infoBoxGetContents(): HTMLElement | null {
        return document.getElementById('info-contents');
    }

    /**
     * Show the info box and its necessary components.
     */
    public infoBoxShow(overrideHidden: boolean = false): void {
        if (!this.infoTrayExplicitlyHidden || overrideHidden) {
            const infoBox = $('#info-container');
            infoBoxCheckUncoverTopBar(infoBox, $('#top-bar'));
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

    /**
     * Set the header/title of the info-box in the embedded view.
     */
    public infoBoxSetTitle(title: string): void {
        $('#info-title').text(title);
    }

    /**
     * Clear the info container and its title, and hide the clear button again.
     */
    public clearInfoBox(hide: boolean = false): void {
        $('#info-contents').html('');
        $('#info-title').text('');
        $('#goto-source-btn').hide();
        $('#goto-cpp-btn').hide();
        $('#goto-edge-start').hide();
        $('#goto-edge-end').hide();
        this.selectedTransformation = null;
        if (hide)
            $('#info-container').removeClass('show');
    }

    private handleShowGroupsContextMenu(
        selectedElements: SDFGElement[], event: Event
    ): void {
        // If elements are selected, show a context menu to add or remove
        // them to or from logical groups.

        // Ensure that all elements belong to the same SDFG.
        let target: JsonSDFG | null = null;
        selectedElements.forEach(elem => {
            if (target === null) {
                target = elem.sdfg;
            } else if (target.cfg_list_id !== elem.sdfg.cfg_list_id) {
                target = null;
                return;
            }
        });

        if (target !== null) {
            const options: {
                label: string | null,
                callback: CallableFunction | null,
                disabled: boolean,
            }[] = [];

            // Add options to add elements to groups.
            (target as JsonSDFG).attributes?.logical_groups.forEach(
                (lg: LogicalGroup) => {
                    options.push({
                        label: `Add selection to group "${lg.name}"`,
                        disabled: false,
                        callback: () => {
                            selectedElements.forEach(el => {
                                if (el instanceof State) {
                                    if (!lg.states.includes(el.id))
                                        lg.states.push(el.id);
                                } else if (el.parent_id !== null) {
                                    const hasTuple = lg.nodes.some((v) => {
                                        return v[0] === el.parent_id &&
                                            v[1] === el.id;
                                    });
                                    if (!hasTuple)
                                        lg.nodes.push([el.parent_id, el.id]);
                                }
                            });

                            const sdfg =
                                VSCodeRenderer.getInstance()?.get_sdfg();
                            if (sdfg)
                                vscodeWriteGraph(sdfg);
                        },
                    });
                }
            );

            // Adds a separator.
            if ((target as JsonSDFG).attributes?.logical_groups)
                options.push({
                    label: null,
                    disabled: true,
                    callback: null,
                });

            // Add options to remove from groups.
            (target as JsonSDFG).attributes?.logical_groups.forEach(
                (lg: LogicalGroup) => {
                    options.push({
                        label: `Remove selection from group "${lg.name}"`,
                        disabled: false,
                        callback: () => {
                            selectedElements.forEach(el => {
                                if (el instanceof State)
                                    lg.states = lg.states.filter(v => {
                                        return v !== el.id;
                                    });
                                else if (el.parent_id !== null)
                                    lg.nodes = lg.nodes.filter(v => {
                                        return v[0] !== el.parent_id ||
                                            v[1] !== el.id;
                                    });
                            });

                            const sdfg =
                                VSCodeRenderer .getInstance()?.get_sdfg();
                            if (sdfg)
                                vscodeWriteGraph(sdfg);
                        },
                    });
                }
            );

            if (options)
                showContextMenu(
                    (event as MouseEvent).clientX,
                    (event as MouseEvent).clientY,
                    options
                );
        }
    }

    private onMouseEvent(
        evtype: string,
        event: Event,
        mousepos: Point2D,
        elements: {
            states: any[],
            nodes: any[],
            connectors: any[],
            edges: any[],
            isedges: any[],
        },
        renderer: SDFGRenderer,
        selectedElements: SDFGElement[],
        sdfv: SDFV,
        endsPan: boolean
    ): boolean {
        const externalRet = mouse_event(
            evtype, event, mousepos, elements, renderer, selectedElements, sdfv,
            endsPan
        );

        if (evtype === 'click' || evtype === 'dblclick') {
            sdfv.sidebar_show();
        } else if (evtype === 'contextmenu') {
            if (VSCodeRenderer.getInstance()?.get_overlay_manager()
                .is_overlay_active(LogicalGroupOverlay))
                VSCodeSDFV.getInstance().handleShowGroupsContextMenu(
                    selectedElements, event
                );

            event.preventDefault();
            return false;
        }

        return externalRet;
    }

    @ICPCRequest()
    public async getCompressedSDFG(): Promise<Uint8Array | null> {
        const sdfgString = this.getSdfgString();
        if (sdfgString)
            return gzipSync(sdfgString);
        return null;
    }

    @ICPCRequest()
    public async outline(
        pRenderer?: SDFGRenderer, pGraph?: DagreGraph
    ): Promise<void> {
        const renderer = pRenderer || this.renderer;
        const graph = pGraph || renderer?.get_graph();
        if (!graph || !renderer)
            return;

        const outlineList = [];

        const topLevelSDFG = {
            'icon': 'res:icons/sdfg.svg',
            'type': 'SDFG',
            'label': `SDFG ${renderer.get_sdfg().attributes.name}`,
            'collapsed': false,
            'uuid': getGraphElementUUID(null),
            'children': [],
        };
        outlineList.push(topLevelSDFG);

        const stack: any[] = [topLevelSDFG];

        traverseSDFGScopes(
            graph, (node) => {
                // Skip exit nodes when scopes are known.
                if (node.type().endsWith('Exit') &&
                    node.data.node.scope_entry >= 0) {
                    stack.push(undefined);
                    return true;
                }

                // Create an entry.
                const isCollapsed = node.attributes().is_collapsed ?? false;
                const nodeLabel = node.type() === 'NestedSDFG' ?
                    node.data.node.label : node.label();

                // If scope has children, remove the name "Entry" from the type.
                let nodeType = node.type();
                if (nodeType.endsWith('Entry')) {
                    const state = node.parent_id !== null ?
                        (node.cfg?.nodes[node.parent_id] as JsonSDFGState) ??
                            null : null;
                    if (state?.scope_dict[node.id])
                        nodeType = nodeType.slice(0, -5);
                }

                let icon;
                switch (nodeType) {
                    case 'Tasklet':
                        icon = 'code';
                        break;
                    case 'Map':
                        icon = 'call_split';
                        break;
                    case 'SDFGState':
                        icon = 'crop_square';
                        break;
                    case 'AccessNode':
                        icon = 'fiber_manual_record';
                        break;
                    case 'NestedSDFG':
                        icon = 'res:icons/sdfg.svg';
                        break;
                    case 'LoopRegion':
                        icon = 'restart_alt';
                        break;
                    case 'ControlFlowRegion':
                        icon = 'turn_sharp_right';
                        break;
                    default:
                        icon = '';
                        break;
                }

                stack.push({
                    'icon': icon,
                    'type': nodeType,
                    'label': nodeLabel,
                    'collapsed': isCollapsed,
                    'uuid': getGraphElementUUID(node),
                    'children': [],
                });

                // If the node's collapsed we don't traverse any further.
                if (isCollapsed)
                    return false;
                return true;
            }, () => {
                // After scope ends, pop ourselves as the current element and
                // add outselves to the parent.
                const elem = stack.pop();
                const elem_parent = stack[stack.length - 1];
                if (elem !== undefined && elem_parent !== undefined)
                    elem_parent['children'].push(elem);
            }
        );

        return SDFVComponent.getInstance().invoke(
            'setOutline', [outlineList], ComponentTarget.Outline
        );
    }

    /**
     * Fill out the info-box of the embedded layout with info about an element.
     * This dynamically builds one or more tables showing all of the relevant
     * info about a given element.
     */
    public fillInfo(elem: SDFGElement): void {
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
            this.infoBoxSetTitle(elem.type() + ' ' + elem.label());

            const contents = $('#info-contents');
            contents.html('');

            if (elem instanceof Edge && elem.data.type === 'Memlet' &&
                elem.parent_id !== null) {
                let sdfg_edge = elem.cfg!.nodes[elem.parent_id].edges[elem.id];
                $('<p>', {
                    'class': 'info-subtitle',
                    'html': 'Connectors: ' + sdfg_edge.src_connector +
                        ' <i class="material-icons">arrow_forward</i> ' +
                        sdfg_edge.dst_connector,
                }).appendTo(contents);
                $('<hr>').appendTo(contents);
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
                        VSCodeRenderer.getInstance()!.getCFGList(),
                        VSCodeRenderer.getInstance()!.getCFGTree(),
                        other_uuid
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

            infoBoxCheckStacking($('#info-container'));
        } else {
            this.clearInfoBox();
        }
    }

    public startFindInGraph(): void {
        const renderer = VSCodeRenderer.getInstance();
        if (renderer)
            setTimeout(() => {
                const searchVal = $('#search').val();
                const graph = renderer.get_graph();
                if (graph && searchVal !== undefined &&
                    typeof searchVal === 'string' && searchVal.length > 0)
                    find_in_graph(
                        this, renderer, graph, searchVal,
                        $('#search-case').is(':checked')
                    );
            }, 1);
    }

    public async refreshSdfg(): Promise<void> {
        return SDFVComponent.getInstance().invoke('getUpToDateContents').then(
            sdfg => {
                this.updateContents(sdfg);
            }
        );
    }

    public setRendererContent(
        sdfg: string | JsonSDFG, previewing: boolean = false,
        preventRefreshes: boolean = false
    ): void {
        const parsedSdfg = typeof sdfg === 'string' ?
            checkCompatLoad(parse_sdfg(sdfg)) : checkCompatLoad(sdfg);
        if (this.renderer) {
            this.renderer.setSDFG(parsedSdfg);
        } else {
            const contentsElem = document.getElementById('contents');
            if (contentsElem === null) {
                console.error('Could not find element to attach renderer to');
                return;
            }

            if (parsedSdfg !== null)
                this.renderer = VSCodeRenderer.init(
                    parsedSdfg, contentsElem,
                    this.onMouseEvent, null, VSCodeSDFV.DEBUG_DRAW, null, null
                );
            else
                return;
        }

        if (!previewing) {
            this.origSDFG = parsedSdfg;
            if (!preventRefreshes) {
                refreshXform(this);
                this.resyncTransformationHistory();
            }
        }

        if (!preventRefreshes) {
            const graph = this.renderer.get_graph();
            if (graph)
                this.outline(this.renderer, graph);
            AnalysisController.getInstance().refreshAnalysisPane();
            refreshBreakpoints();
        }

        const selectedElements = this.renderer.get_selected_elements();
        if (selectedElements && selectedElements.length === 1)
            reselectRendererElement(selectedElements[0]);
        else if (!selectedElements || selectedElements.length === 0)
            this.fillInfo(
                new SDFG(this.renderer.get_sdfg())
            );
    }

    public resetRendererContent(): void {
        if (!this.origSDFG)
            return;

        let userTransform = null;
        let renderer = VSCodeRenderer.getInstance();
        if (renderer) {
            userTransform = renderer.get_canvas_manager()?.get_user_transform();
            renderer.destroy();
        }

        const contentsElem = document.getElementById('contents');
        if (contentsElem === null) {
            console.error('Could not find element to attach renderer to');
            return;
        }

        renderer = VSCodeRenderer.init(
            this.origSDFG, contentsElem, this.onMouseEvent, userTransform,
            VSCodeSDFV.DEBUG_DRAW, null, null
        );

        const graph = renderer?.get_graph();
        if (renderer && graph) {
            this.outline(renderer, graph);
            AnalysisController.getInstance().refreshAnalysisPane();
            refreshBreakpoints();
        }
    }

    /*
     * Send a request to the extension to jump to a specific source code file
     * and location, if it exists.
     */
    public async gotoSource(
        filePath: string, startRow: number, startChar: number, endRow: number,
        endChar: number
    ): Promise<void> {
        return SDFVComponent.getInstance().invoke(
            'goToSource', [filePath, startRow, startChar, endRow, endChar]
        );
    }

    /*
     * Send a request to the extension to jump to the generated code location of
     * the current Node.
     */
    public async gotoCpp(
        sdfgName: string, sdfgId: number, stateId: number, nodeId: number
    ): Promise<void> {
        return SDFVComponent.getInstance().invoke(
            'goToCPP', [sdfgName, sdfgId, stateId, nodeId]
        );
    }

    public toggleBreakpoints(): void {
        this.setShowingBreakpoints(!this.showingBreakpoints);
    }

    public getMonaco(): any | null {
        return this.monaco;
    }

    public async getMetaDict(): Promise<Record<string, any>> {
        if (!this.sdfgMetaDict) {
            // If SDFG property metadata isn't available, use the static one and
            // query an up-to-date one from the dace github page. If that
            // doesn't work, query the daemon (waking it up if it isn't up).
            if (!this.queryMetaDictFunc) {
                this.queryMetaDictFunc = new Promise((resolve) => {
                    SDFVComponent.getInstance().invoke(
                        'querySdfgMetadata', undefined, ComponentTarget.DaCe
                    ).then((metaDict: Record<string, any>) => {
                        resolve(metaDict);
                    }).catch(() => {
                        fetch(
                            'https://spcl.github.io/dace/metadata/' +
                                'sdfg_meta_dict.json'
                        ).then((response) => {
                            resolve(response.json());
                        });
                    });
                });
            }

            return this.queryMetaDictFunc.then((data) => {
                this.sdfgMetaDict = data;
                this.queryMetaDictFunc = null;
                return this.sdfgMetaDict;
            }).catch((reason) => {
                console.error(reason);
                this.sdfgMetaDict = staticSdfgMetaDict;
                this.queryMetaDictFunc = null;
                return this.sdfgMetaDict;
            });
        }
        return this.sdfgMetaDict;
    }

    public getCachedMetaDict(): Record<string, any> | null {
        return this.sdfgMetaDict;
    }

    public getViewingHistoryState(): boolean {
        return this.viewingHistoryState;
    }

    public getViewingHistoryIndex(): number | undefined {
        return this.viewingHistoryIndex;
    }

    public getViewingCompressed(): boolean {
        return this.viewingCompressed;
    }

    public getShowingBreakpoints(): boolean {
        return this.showingBreakpoints;
    }

    public getDaemonConnected(): boolean {
        return this.daemonConnected;
    }

    public getTransformations(): JsonTransformationList {
        return this.transformations;
    }

    public getSelectedTransformation(): JsonTransformation | null {
        return this.selectedTransformation;
    }

    public setMonaco(monaco: any | null): void {
        this.monaco = monaco;
    }

    public getSdfgString(): string | null {
        const sdfg = this.get_renderer()?.get_sdfg();
        if (sdfg) {
            unGraphiphySdfg(sdfg);
            const sdfgString = JSON.stringify(sdfg, (_k, v) => {
                return v === undefined ? null : v;
            }, 2);
            return sdfgString;
        }
        return null;
    }

    @ICPCRequest()
    public setMetaDict(sdfgMetaDict: { [key: string]: any } | null): void {
        this.sdfgMetaDict = sdfgMetaDict;
    }

    public setViewingHistoryState(
        viewingHistoryState: boolean, index?: number
    ): void {
        this.viewingHistoryState = viewingHistoryState;
        if (!viewingHistoryState)
            this.viewingHistoryIndex = undefined;
        else
            this.viewingHistoryIndex = index;
    }

    @ICPCRequest()
    public setShowingBreakpoints(showingBreakpoints: boolean): void {
        this.showingBreakpoints = showingBreakpoints;
        const alreadyActive =
            VSCodeRenderer.getInstance()?.get_overlay_manager().get_overlay(
                BreakpointIndicator
            );
        if (this.showingBreakpoints && alreadyActive === undefined) {
            vscode.postMessage({
                type: 'sdfv.register_breakpointindicator',
            });
            $('#breakpoint-btn').text('Hide Breakpoints');
        } else if (!this.showingBreakpoints) {
            vscode.postMessage({
                type: 'sdfv.deregister_breakpointindicator',
            });
            $('#breakpoint-btn').text('Display Breakpoints');
        }
    }

    @ICPCRequest()
    public setDaemonConnected(daemonConnected: boolean = true): void {
        this.daemonConnected = daemonConnected;
        VSCodeRenderer.getInstance()?.setDaemonConnected(daemonConnected);
    }

    public setTransformations(transformations: JsonTransformationList): void {
        this.transformations = transformations;
    }

    public setSelectedTransformation(
        selectedTransformation: JsonTransformation | null
    ): void {
        this.selectedTransformation = selectedTransformation;
    }

    public set_renderer(renderer: SDFGRenderer | null): void {
        if (renderer) {
            this.localViewRenderer?.destroy();
            this.localViewRenderer = null;
        }
        this.renderer = renderer;
    }

    public setLocalViewRenderer(localViewRenderer: LViewRenderer | null): void {
        if (localViewRenderer) {
            this.renderer?.destroy();
            this.renderer = null;
        }
        this.localViewRenderer = localViewRenderer;
        this.infoBoxShow(true);
    }

    @ICPCRequest()
    public updateContents(
        newContent: string | Uint8Array, preventRefreshes: boolean = false
    ): void {
        const t1 = performance.now();
        this.setViewingHistoryState(false);
        $('#exit-preview-button')?.hide();
        const [content, compressed] = read_or_decompress(newContent);
        this.viewingCompressed = compressed;
        const t2 = performance.now();
        this.setRendererContent(content, false, preventRefreshes);
        const t3 = performance.now();
        console.debug('parsing contents took ' + (t2 - t1) + 'ms');
        console.debug('updating renderer took ' + (t3 - t2) + 'ms');
    }

    /**
     * Preview a specific SDFG.
     * If no SDFG is provided, this exits any active preview.
     * If `histState` is provided, the preview is of an SDFG at a history state,
     * making the application of transformations impossible.
     * @param pSdfg     SDFG to preview
     * @param histState Whether or not this is a history state
     * @param refresh   Whether or not to refresh the transformation list
     */
    @ICPCRequest()
    public previewSdfg(
        pSdfg?: string, histIndex: number | undefined = undefined,
        refresh: boolean = false
    ): void {
        if (pSdfg) {
            this.setRendererContent(pSdfg, true);
            $('#exit-preview-button')?.show();
            if (histIndex !== undefined) {
                this.clearInfoBox();
                this.setViewingHistoryState(true, histIndex);
                refreshTransformationList();
            }
        } else {
            // No SDFG provided, exit preview.
            this.resetRendererContent();
            this.setViewingHistoryState(false);
            $('#exit-preview-button')?.hide();
            if (refresh)
                refreshTransformationList();
        }
    }

    @ICPCRequest()
    public setProcessingOverlay(show: boolean = false, text?: string): void {
        if (show) {
            this.processingOverlay?.show();
            this.processingOverlayMsg?.text(text ?? '');
        } else {
            this.processingOverlay?.hide();
            this.processingOverlayMsg?.text('');
        }
    }

    @ICPCRequest()
    public async resyncTransformations(hard: boolean = false): Promise<void> {
        const xforms = this.getTransformations();
        clearSelectedTransformation();
        if (hard ||
            (xforms.selection.length === 0 &&
             xforms.viewport.length === 0 &&
             xforms.passes.length === 0 &&
             xforms.uncategorized.length === 0))
            await refreshXform(this);
        else
            await refreshTransformationList();
    }

    @ICPCRequest()
    public async selectTransformation(
        transformation: JsonTransformation
    ): Promise<void> {
        showTransformationDetails(transformation);
        this.setSelectedTransformation(transformation);
    }

    @ICPCRequest()
    public async resyncTransformationHistory(): Promise<void> {
        const sdfg = this.get_renderer()?.get_sdfg();
        if (sdfg) {
            const transformationHistory = jsonSDFGElemReadAttr(
                sdfg, 'transformation_hist'
            ) ?? [];
            SDFVComponent.getInstance().invoke(
                'setHistory',
                [transformationHistory, this.viewingHistoryIndex],
                ComponentTarget.History
            );
        }
    }

    @ICPCRequest()
    public async toggleCollapseFor(uuid: string): Promise<void> {
        const renderer = this.renderer;
        const cfgList = renderer?.getCFGList();
        if (renderer && cfgList) {
            const [elem, _] = findJsonSDFGElementByUUID(cfgList, uuid);
            if (elem && isCollapsible(elem)) {
                elem.attributes.is_collapsed = !jsonSDFGElemReadAttr(
                    elem, 'is_collapsed'
                );
                renderer.emit('collapse_state_changed');
                renderer.relayout();
                renderer.draw_async();
            }
        }
    }

    @ICPCRequest()
    public async setOverlays(overlays: string[]): Promise<void> {
        const overlayManager =
            VSCodeRenderer.getInstance()?.get_overlay_manager();
        const activeOverlays = overlayManager?.get_overlays();

        const toActivate = [];
        for (const ol of overlays)
            toActivate.push(VSCodeSDFV.OVERLAYS[ol]);

        // Deregister any previously active overlays.
        overlayManager?.deregisterAll(toActivate);

        // Register all the selected overlays.
        for (const ol of toActivate) {
            if (!overlayManager?.is_overlay_active(ol))
                overlayManager?.register_overlay(ol);
        }
    }

    @ICPCRequest()
    public async specialize(valueMap: SymbolMap): Promise<void> {
        this.setProcessingOverlay(true, 'Specializing');
        const specialized = await SDFVComponent.getInstance().invoke(
            'specializeGraph',
            [this.getSdfgString(), valueMap], ComponentTarget.DaCe
        );
        this.setRendererContent(specialized, false, false);
        this.setProcessingOverlay(false);
    }

}

export class SDFVComponent extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE = new SDFVComponent();

    private constructor() {
        super(ComponentTarget.Editor);
    }

    public static getInstance(): SDFVComponent {
        return SDFVComponent.INSTANCE;
    }

    public init(): void {
        super.init(vscode, window);

        this.register(zoomToUUIDs);
        this.register(highlightUUIDs);
        this.register(refreshTransformationList);

        const sdfv = VSCodeSDFV.getInstance();
        this.registerRequestHandler(sdfv);
        this.registerRequestHandler(AnalysisController.getInstance());

        // Load the default settings.
        this.invoke('getSettings', [SDFVSettings.settingsKeys]).then(
            (settings: Record<SDFVSettingKey, SDFVSettingValT>) => {
                for (const [k, v] of Object.entries(settings))
                    SDFVSettings.set(k as SDFVSettingKey, v);
                sdfv.initialize();
                sdfv.get_renderer()?.draw_async();
            }
        );
    }

}

function infoBoxCheckUncoverTopBar(
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
function infoBoxCheckStacking(infoContainer?: JQuery<HTMLElement>): void {
    const innerWidth = infoContainer?.innerWidth();
    if (innerWidth && innerWidth <= 575)
        infoContainer?.addClass('stacked');
    else
        infoContainer?.removeClass('stacked');
}

$(() => {
    SDFVComponent.getInstance().init();

    $('#breakpoint-btn').on('click', () => {
        VSCodeSDFV.getInstance().toggleBreakpoints();
    });

    document.body.onresize = () => {
        const renderer = VSCodeRenderer.getInstance();
        if (renderer) {
            renderer.onresize();
            renderer.draw_async();
        }
    };

    $('body').show();
});
