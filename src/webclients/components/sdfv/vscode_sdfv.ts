// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as $ from 'jquery';
(window as any).jQuery = $;

// JQuery Plugin to allow for editable selects.
import 'jquery-editable-select';
import 'jquery-editable-select/dist/jquery-editable-select.min.css';

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import '@spcl/sdfv/sdfv.css';

import './vscode_sdfv.css';

import * as staticSdfgMetaDict from '../../../utils/sdfg_meta_dict.json';

import {
    AccessNode,
    DagreSDFG,
    Edge,
    EntryNode,
    ExitNode,
    find_graph_element_by_uuid,
    find_in_graph,
    GenericSdfgOverlay,
    get_uuid_graph_element,
    JsonSDFG,
    LogicalGroup,
    LogicalGroupOverlay,
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    mouse_event,
    NestedSDFG,
    OperationalIntensityOverlay,
    parse_sdfg,
    Point2D,
    RuntimeMicroSecondsOverlay,
    ScopeNode,
    SDFG,
    SDFGElement,
    SDFGNode,
    SDFGRenderer,
    SDFGRendererEvent,
    SDFV,
    State,
    StaticFlopsOverlay,
    traverse_sdfg_scopes
} from '@spcl/sdfv/out';
import { LViewRenderer } from '@spcl/sdfv/out/local_view/lview_renderer';
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
import { refreshAnalysisPane } from './analysis/analysis';
import {
    BreakpointIndicator,
    refreshBreakpoints
} from './breakpoints/breakpoints';
import { VSCodeRenderer } from './renderer/vscode_renderer';
import {
    clearSelectedTransformation,
    refreshTransformationList,
    refreshXform,
    showTransformationDetails,
    sortTransformations
} from './transformation/transformation';
import {
    appendDataDescriptorTable,
    generateAttributesTable
} from './utils/attributes_table';
import {
    highlightUUIDs,
    reselectRendererElement,
    showContextMenu,
    vscodeWriteGraph,
    zoomToUUIDs
} from './utils/helpers';

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
            'RuntimeMicroSecondsOverlay': RuntimeMicroSecondsOverlay,
            'BreakpointIndicator': BreakpointIndicator,
            'MemoryLocationOverlay': MemoryLocationOverlay,
            'OperationalIntensityOverlay': OperationalIntensityOverlay,
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
    private infoBarLastVertWidth: string = '250px';
    private infoBarLastHorHeight: string = '200px';

    private monaco: any | null = null;
    private sdfgString: string | null = null;
    private sdfgMetaDict: { [key: string]: any } | null = null;
    private queryMetaDictFunc: Promise<{ [key: string]: any }> | null= null;
    private viewingHistoryState: boolean = false;
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

    public async initialize(): Promise<void> {
        this.initDOM();
        this.initInfoBox();
        this.initSearch();

        await this.refreshSdfg();
        this.processingOverlay?.hide();
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
                        this.infoBarLastHorHeight = newHeight.toString() + 'px';
                        this.infoContainer?.height(this.infoBarLastHorHeight);
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
                        this.infoBarLastVertWidth = newWidth.toString() + 'px';
                        this.infoContainer?.width(this.infoBarLastVertWidth);
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
                this.expandInfoBtn?.removeClass('expand-info-btn-top');
                this.expandInfoBtn?.addClass('expand-info-btn-bottom');
                $(document).off('mousemove', infoChangeWidthHandler);
                $(document).on('mousemove', infoChangeHeightHandler);
                this.infoContainer?.width('100%');
                this.infoContainer?.height(this.infoBarLastHorHeight);
            } else {
                this.infoContainer?.removeClass('offcanvas-bottom');
                this.infoContainer?.addClass('offcanvas-end');
                this.infoDragBar?.removeClass('gutter-horizontal');
                this.infoDragBar?.addClass('gutter-vertical');
                this.expandInfoBtn?.removeClass('expand-info-btn-bottom');
                this.expandInfoBtn?.addClass('expand-info-btn-top');
                $(document).off('mousemove', infoChangeHeightHandler);
                $(document).on('mousemove', infoChangeWidthHandler);
                this.infoContainer?.height('100%');
                this.infoContainer?.width(this.infoBarLastVertWidth);
            }

            infoBoxCheckStacking(this.infoContainer);
            infoBoxCheckUncoverTopBar(this.infoContainer, this.topBar);

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
        });
        this.expandInfoBtn?.on('click', () => {
            this.expandInfoBtn?.hide();
            infoBoxCheckUncoverTopBar(this.infoContainer, this.topBar);
            this.infoContainer?.addClass('show');
            VSCodeSDFV.getInstance().infoTrayExplicitlyHidden = false;
        });
    }

    public initSearch(): void {
        const caseBtn = $('#search-case-sensitive-btn');
        const searchInput = $('#search');
        caseBtn.on('click', () => {
            if (caseBtn) {
                if (caseBtn)
                    if (caseBtn.css('background-color') === 'transparent') {
                        caseBtn.css('background-color', '#245779');
                        caseBtn.prop('checked', true);
                    } else {
                        caseBtn.css('background-color', 'transparent');
                        caseBtn.prop('checked', false);
                    }
            }

            VSCodeSDFV.getInstance().startFindInGraph();
        });

        // Start search whenever text is entered in the search bar.
        searchInput.on('input', () => {
            VSCodeSDFV.getInstance().startFindInGraph();
        });

        // Start search on enter press in the search bar.
        searchInput.on('keydown', (e) => {
            if (e.key === 'Enter')
                VSCodeSDFV.getInstance().startFindInGraph();
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
        }
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
            } else if (target.sdfg_list_id !== elem.sdfg.sdfg_list_id) {
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
    public async outline(
        pRenderer?: SDFGRenderer, pGraph?: DagreSDFG
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
            'uuid': get_uuid_graph_element(null),
            'children': [],
        };
        outlineList.push(topLevelSDFG);

        const stack: any[] = [topLevelSDFG];

        traverse_sdfg_scopes(
            graph, (node: SDFGNode, _parent: SDFGElement): boolean => {
                // Skip exit nodes when scopes are known.
                if (node.type().endsWith('Exit') &&
                    node.data.node.scope_entry >= 0) {
                    stack.push(undefined);
                    return true;
                }

                // Create an entry.
                let isCollapsed = node.attributes().is_collapsed;
                isCollapsed = (isCollapsed === undefined) ?
                    false : isCollapsed;
                let nodeLabel = node.label();
                if (node.type() === 'NestedSDFG')
                    nodeLabel = node.data.node.label;

                // If scope has children, remove the name "Entry" from the type.
                let nodeType = node.type();
                if (nodeType.endsWith('Entry')) {
                    const state = node.parent_id !== null ?
                        node.sdfg.nodes[node.parent_id] : null;
                    if (state && state.scope_dict[node.id] !== undefined)
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
                    default:
                        icon = '';
                        break;
                }

                stack.push({
                    'icon': icon,
                    'type': nodeType,
                    'label': nodeLabel,
                    'collapsed': isCollapsed,
                    'uuid': get_uuid_graph_element(node),
                    'children': [],
                });

                // If the node's collapsed we don't traverse any further.
                if (isCollapsed)
                    return false;
                return true;
            }, (_node: SDFGNode, _parent: SDFGElement) => {
                // After scope ends, pop ourselves as the current element and
                // add outselves to the parent.
                const elem = stack.pop();
                const elem_parent = stack[stack.length - 1];
                if (elem !== undefined && elem_parent !== undefined)
                    elem_parent['children'].push(elem);
            }
        );

        return SDFVComponent.getInstance().invoke('setOutline', [outlineList]);
    }

    /**
     * Fill out the info-box of the embedded layout with info about an element.
     * This dynamically builds one or more tables showing all of the relevant
     * info about a given element.
     */
    public fillInfo(elem: SDFGElement): void {
        const buttons = [
            $('#goto-source-btn'),
            $('#goto-cpp-btn')
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
                let sdfg_edge = elem.sdfg.nodes[elem.parent_id].edges[elem.id];
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
                if (elem instanceof EntryNode)
                    other_uuid = elem.sdfg.sdfg_list_id + '/' +
                        elem.parent_id + '/' +
                        elem.data.node.scope_exit + '/-1';
                else if (elem instanceof ExitNode)
                    other_uuid = elem.sdfg.sdfg_list_id + '/' +
                        elem.parent_id + '/' +
                        elem.data.node.scope_entry + '/-1';

                if (other_uuid) {
                    const ret_other_elem = find_graph_element_by_uuid(
                        VSCodeRenderer.getInstance()?.get_graph(),
                        other_uuid
                    );
                    other_element = ret_other_elem.element;
                }

                if (other_element) {
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
                if (elem.data && elem.data.attributes)
                    appendDataDescriptorTable(
                        contents, elem.data.attributes._arrays, elem.data
                    );
            } else if (elem instanceof NestedSDFG) {
                if (elem.data && elem.data.node.attributes)
                    appendDataDescriptorTable(
                        contents,
                        elem.data.node.attributes.sdfg.attributes._arrays,
                        elem.data.node.attributes.sdfg
                    );
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
                        $('#search-case-sensitive-btn').is(':checked')
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
        sdfgString: string, previewing: boolean = false,
        preventRefreshes: boolean = false
    ): void {
        const parsedSdfg = parse_sdfg(sdfgString);
        if (this.renderer) {
            this.renderer.set_sdfg(parsedSdfg);
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
            this.sdfgString = sdfgString;
            if (!preventRefreshes)
                refreshXform(this);
        }

        const graph = this.renderer.get_graph();
        if (graph)
            this.outline(this.renderer, graph);
        refreshAnalysisPane();
        refreshBreakpoints();

        const selectedElements = this.renderer.get_selected_elements();
        if (selectedElements && selectedElements.length === 1)
            reselectRendererElement(selectedElements[0]);
        else if (!selectedElements || selectedElements.length === 0)
            this.fillInfo(
                new SDFG(this.renderer.get_sdfg())
            );

        const sdfgName = this.renderer.get_sdfg().attributes.name;
        SDFVComponent.getInstance().invoke(
            'processQueuedInvocations', [sdfgName]
        );
    }

    public resetRendererContent(): void {
        if (!this.sdfgString)
            return;

        let userTransform = null;
        let renderer = VSCodeRenderer.getInstance();
        if (renderer) {
            userTransform = renderer.get_canvas_manager()?.get_user_transform();
            renderer.destroy();
        }

        const parsedSdfg = parse_sdfg(this.sdfgString);
        if (parsedSdfg !== null) {
            const contentsElem = document.getElementById('contents');
            if (contentsElem === null) {
                console.error('Could not find element to attach renderer to');
                return;
            }

            renderer = VSCodeRenderer.init(
                parsedSdfg, contentsElem, this.onMouseEvent, userTransform,
                VSCodeSDFV.DEBUG_DRAW, null, null
            );
        }

        const graph = renderer?.get_graph();
        if (renderer && graph) {
            this.outline(renderer, graph);
            refreshAnalysisPane();
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

    public getSdfgString(): string | null {
        return this.sdfgString;
    }

    public async getMetaDict(): Promise<{ [key: string]: any }> {
        if (!this.sdfgMetaDict) {
            // If SDFG property metadata isn't available, use the static one and
            // query an up-to-date one from the dace github page. If that
            // doesn't work, query the daemon (waking it up if it isn't up).
            if (!this.queryMetaDictFunc)
                this.queryMetaDictFunc = fetch(
                    'https://spcl.github.io/dace/metadata/sdfg_meta_dict.json'
                ).then(
                    (response) => response.json()
                );

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

    public getViewingHistoryState(): boolean {
        return this.viewingHistoryState;
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

    public setSdfgString(sdfgString: string | null): void {
        this.sdfgString = sdfgString;
    }

    @ICPCRequest()
    public setMetaDict(sdfgMetaDict: { [key: string]: any } | null): void {
        this.sdfgMetaDict = sdfgMetaDict;
    }

    public setViewingHistoryState(viewingHistoryState: boolean): void {
        this.viewingHistoryState = viewingHistoryState;
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
            $('#display-bps').html('Hide Breakpoints');
        } else if (!this.showingBreakpoints) {
            vscode.postMessage({
                type: 'sdfv.deregister_breakpointindicator',
            });
            $('#display-bps').html('Display Breakpoints');
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
        newContent: string, preventRefreshes: boolean = false
    ): void {
        this.setViewingHistoryState(false);
        $('#exit-preview-button')?.addClass('hidden');
        this.setRendererContent(newContent, false, preventRefreshes);
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
        pSdfg?: string, histState: boolean = false, refresh: boolean = false
    ): void {
        if (pSdfg) {
            this.setRendererContent(pSdfg, true);
            $('#exit-preview-button')?.removeClass('hidden');
            if (histState) {
                this.clearInfoBox();
                this.setViewingHistoryState(true);
                refreshTransformationList();
            }
        } else {
            // No SDFG provided, exit preview.
            this.resetRendererContent();
            this.setViewingHistoryState(false);
            $('#exit-preview-button')?.addClass('hidden');
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

}

export class SDFVComponent extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE = new SDFVComponent();

    private constructor() {
        super();
    }

    public static getInstance(): SDFVComponent {
        return SDFVComponent.INSTANCE;
    }

    public init(): void {
        super.init(vscode, window);

        this.register(zoomToUUIDs);
        this.register(highlightUUIDs);
        this.register(refreshAnalysisPane);
        this.register(refreshTransformationList);

        const sdfv = VSCodeSDFV.getInstance();
        this.registerRequestHandler(sdfv);
        sdfv.initialize();
    }

}

export function vscodeHandleEvent(event: string, data: any): void {
    switch (event) {
        case 'remove_graph_nodes':
            if (data && data.nodes)
                VSCodeRenderer.getInstance()?.removeGraphNodes(data.nodes);
            break;
        case SDFGRendererEvent.ADD_ELEMENT:
            if (data && data.type !== undefined && data.parent !== undefined &&
                data.lib !== undefined && data.edgeA !== undefined)
                VSCodeRenderer.getInstance()?.addNodeToGraph(
                    data.type, data.parent, data.lib, data.edgeA,
                    data.edgeAConn ? data.edgeAConn : null,
                    data.conn ? data.conn : null
                );
            break;
        case SDFGRendererEvent.QUERY_LIBNODE:
            if (data && data.callback)
                VSCodeRenderer.getInstance()?.showSelectLibraryNodeDialog(
                    data.callback
                );
            break;
        case 'warn_no_daemon':
            VSCodeRenderer.getInstance()?.showNoDaemonDialog();
            break;
        case SDFGRendererEvent.ACTIVE_OVERLAYS_CHANGED:
            refreshAnalysisPane();
            break;
        case SDFGRendererEvent.EXIT_PREVIEW:
            SDFVComponent.getInstance().invoke(
                'getUpToDateContents'
            ).then(sdfg => {
                VSCodeSDFV.getInstance().updateContents(sdfg, true);
                SDFVComponent.getInstance().invoke(
                    'refreshTransformationHistory', [true]
                );
            });
            break;
        case SDFGRendererEvent.COLLAPSE_STATE_CHANGED:
        case SDFGRendererEvent.ELEMENT_POSITION_CHANGED:
            VSCodeRenderer.getInstance()?.sendNewSdfgToVscode();
            break;
        case SDFGRendererEvent.SELECTION_CHANGED:
            if (data && data.multi_selection_changed)
                refreshXform(VSCodeSDFV.getInstance());
            else
                sortTransformations(false, refreshTransformationList, true);
            break;
        case SDFGRendererEvent.BACKEND_DATA_REQUESTED:
            if (data && data.type) {
                switch (data.type) {
                    case 'flops':
                        SDFVComponent.getInstance().invoke('getFLops')
                            .then((flopsMap) => {
                                if (!flopsMap)
                                    return;
                                const renderer = VSCodeRenderer.getInstance();
                                const oMan = renderer?.get_overlay_manager();
                                const oType = VSCodeSDFV.OVERLAYS[data.overlay];
                                const ol = oMan?.get_overlay(oType);
                                (ol as
                                    StaticFlopsOverlay |
                                    OperationalIntensityOverlay
                                )?.update_flops_map(flopsMap);
                            });
                        break;
                }
            }
            break;
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
