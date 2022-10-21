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
    traverse_sdfg_scopes,
} from '@spcl/sdfv/out';
import { JsonTransformation, JsonTransformationList } from '../transformations/transformations';
import { refreshAnalysisPane } from './analysis/analysis';
import {
    BreakpointIndicator,
    refreshBreakpoints,
} from './breakpoints/breakpoints';
import { MessageHandler } from './messaging/message_handler';
import { VSCodeRenderer } from './renderer/vscode_renderer';
import {
    getApplicableTransformations,
    refreshTransformationList,
    sortTransformations,
} from './transformation/transformation';
import {
    appendDataDescriptorTable,
    generateAttributesTable,
} from './utils/attributes_table';
import {
    reselectRendererElement,
    showContextMenu,
    vscodeWriteGraph,
} from './utils/helpers';
import { LViewRenderer } from '@spcl/sdfv/out/local_view/lview_renderer';

declare const vscode: any;
declare let SPLIT_DIRECTION: 'vertical' | 'horizontal';

type CategorizedTransformationList = [
    JsonTransformation[],
    JsonTransformation[],
    JsonTransformation[],
    JsonTransformation[],
];

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

    public initInfoBox(): void {
        // Pass.
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

    public outline(renderer: SDFGRenderer, graph: DagreSDFG): void {
        if (vscode === undefined)
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

        vscode.postMessage({
            type: 'outline.set_outline',
            outlineList: outlineList,
        });
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

    public refreshSdfg(): void {
        if (vscode)
            vscode.postMessage({
                type: 'sdfv.get_current_sdfg',
            });
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
                getApplicableTransformations();
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

        vscode.postMessage({
            type: 'sdfv.process_queued_messages',
            sdfgName: this.renderer.get_sdfg().attributes.name,
        });
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
    public gotoSource(
        filePath: string, startRow: number, startChar: number, endRow: number,
        endChar: number
    ): void {
        vscode.postMessage({
            type: 'sdfv.go_to_source',
            filePath: filePath,
            startRow: startRow,
            startChar: startChar,
            endRow: endRow,
            endChar: endChar,
        });
    }

    /*
     * Send a request to the extension to jump to the generated code location of
     * the current Node.
     */
    public gotoCpp(
        sdfgName: string, sdfgId: number, stateId: number, nodeId: number
    ): void {
        vscode.postMessage({
            type: 'sdfv.go_to_cpp',
            sdfgName: sdfgName,
            sdfgId: sdfgId,
            stateId: stateId,
            nodeId: nodeId
        });
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

    public setMetaDict(sdfgMetaDict: { [key: string]: any } | null): void {
        this.sdfgMetaDict = sdfgMetaDict;
    }

    public setViewingHistoryState(viewingHistoryState: boolean): void {
        this.viewingHistoryState = viewingHistoryState;
    }

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

    public setDaemonConnected(daemonConnected: boolean): void {
        this.daemonConnected = daemonConnected;
        VSCodeRenderer.getInstance()?.setDaemonConnected(daemonConnected);
    }

    public setTransformations(transformations: JsonTransformationList): void {
        console.log(transformations);

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
        case 'active_overlays_changed':
            refreshAnalysisPane();
            break;
        case 'exit_preview':
            VSCodeSDFV.getInstance().setViewingHistoryState(false);
            break;
        case 'collapse_state_changed':
        case 'position_changed':
            VSCodeRenderer.getInstance()?.sendNewSdfgToVscode();
            break;
        case 'renderer_selection_changed':
            if (data && data.multi_selection_changed)
                getApplicableTransformations();
            else
                sortTransformations(false, refreshTransformationList, true);
            break;
    }
}

function infoBoxCheckUncoverTopBar(
    infoContainer: JQuery<HTMLElement>, topBar: JQuery<HTMLElement>
): void {
    // If the info container is to the side, ensure it doesn't cover up the
    // top bar when shown.
    if (infoContainer.hasClass('offcanvas-end')) {
        const topBarHeight = topBar.outerHeight(false);
        infoContainer.css('top', topBarHeight + 'px');
    } else {
        infoContainer.css('top', '');
    }
}

/**
 * Check if the info box is wide enough to show keys / values side-by-side.
 * If not, stack them one on top of the other.
 * @param infoContainer The info box container.
 */
function infoBoxCheckStacking(infoContainer: JQuery<HTMLElement>): void {
    const innerWidth = infoContainer.innerWidth();
    if (innerWidth && innerWidth <= 575) {
        if (infoContainer.attr('stack') !== 'true') {
            infoContainer.attr('stack', 'true');
            $('.attr-cell-s').removeClass('col-3').addClass('col-12');
            $('.attr-cell-l').removeClass('col-9').addClass('col-12');
        }
    } else {
        if (infoContainer.attr('stack') === 'true') {
            infoContainer.attr('stack', 'false');
            $('.attr-cell-s').removeClass('col-12').addClass('col-3');
            $('.attr-cell-l').removeClass('col-12').addClass('col-9');
        }
    }
}

$(() => {
    const infoContainer = $('#info-container');
    const layoutToggleBtn = $('#layout-toggle-btn');
    const infoDragBar = $('#info-drag-bar');
    const expandInfoBtn = $('#expand-info-btn');
    const infoCloseBtn = $('#info-close-btn');
    const topBar = $('#top-bar');

    // Set up resizing of the info drawer.
    let draggingDragInfoBar = false;
    let lastVertWidth = infoContainer.css('min-width');
    let lastHorHeight = infoContainer.css('min-height');
    const infoChangeHeightHandler = (e: any) => {
        if (draggingDragInfoBar) {
            const documentHeight = $('body').innerHeight();
            if (documentHeight) {
                const newHeight = documentHeight - e.originalEvent.y;
                if (newHeight < documentHeight) {
                    lastHorHeight = newHeight.toString() + 'px';
                    infoContainer.height(lastHorHeight);
                }
            }
        }
    };
    const infoChangeWidthHandler = (e: any) => {
        if (draggingDragInfoBar) {
            const documentWidth = $('body').innerWidth();
            if (documentWidth) {
                const newWidth = documentWidth - e.originalEvent.x;
                if (newWidth < documentWidth) {
                    lastVertWidth = newWidth.toString() + 'px';
                    infoContainer.width(lastVertWidth);
                }
            }
        }
    };
    $(document).on('mouseup', () => {
        draggingDragInfoBar = false;
    });
    infoDragBar.on('mousedown', () => {
        draggingDragInfoBar = true;
    });
    if (SPLIT_DIRECTION === 'vertical')
        $(document).on('mousemove', infoChangeWidthHandler);
    else
        $(document).on('mousemove', infoChangeHeightHandler);

    // Set up changing the info drawer layout.
    layoutToggleBtn.on('click', () => {
        const oldDir = SPLIT_DIRECTION;
        SPLIT_DIRECTION = SPLIT_DIRECTION === 'vertical' ?
            'horizontal' : 'vertical';
        layoutToggleBtn.removeClass(oldDir);
        layoutToggleBtn.addClass(SPLIT_DIRECTION);
        if (oldDir === 'vertical') {
            infoContainer.removeClass('offcanvas-end');
            infoContainer.addClass('offcanvas-bottom');
            infoDragBar.removeClass('gutter-vertical');
            infoDragBar.addClass('gutter-horizontal');
            expandInfoBtn.removeClass('expand-info-btn-top');
            expandInfoBtn.addClass('expand-info-btn-bottom');
            $(document).off('mousemove', infoChangeWidthHandler);
            $(document).on('mousemove', infoChangeHeightHandler);
            infoContainer.width('100%');
            infoContainer.height(lastHorHeight);
        } else {
            infoContainer.removeClass('offcanvas-bottom');
            infoContainer.addClass('offcanvas-end');
            infoDragBar.removeClass('gutter-horizontal');
            infoDragBar.addClass('gutter-vertical');
            expandInfoBtn.removeClass('expand-info-btn-bottom');
            expandInfoBtn.addClass('expand-info-btn-top');
            $(document).off('mousemove', infoChangeHeightHandler);
            $(document).on('mousemove', infoChangeWidthHandler);
            infoContainer.height('100%');
            infoContainer.width(lastVertWidth);
        }
        infoBoxCheckStacking(infoContainer);
        infoBoxCheckUncoverTopBar(infoContainer, topBar);
        vscode.postMessage({
            type: 'sdfv.set_split_direction',
            direction: SPLIT_DIRECTION,
        });
    });

    new ResizeObserver(() => {
        infoBoxCheckStacking(infoContainer);
    }).observe(infoContainer[0]);

    // Set up toggling the info tray.
    infoCloseBtn.on('click', () => {
        expandInfoBtn.show();
        infoContainer.removeClass('show');
        VSCodeSDFV.getInstance().infoTrayExplicitlyHidden = true;
    });
    expandInfoBtn.on('click', () => {
        expandInfoBtn.hide();
        infoBoxCheckUncoverTopBar(infoContainer, topBar);
        infoContainer.addClass('show');
        VSCodeSDFV.getInstance().infoTrayExplicitlyHidden = false;
    });

    $('#processing-overlay').hide();
    vscode.postMessage({
        type: 'sdfv.get_current_sdfg',
    });

    $('#search-case-sensitive-btn').on('click', function () {
        const caseBtn = $('#search-case-sensitive-btn');
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
    $('#search').on('input', function (e) {
        VSCodeSDFV.getInstance().startFindInGraph();
    });

    // Start search on enter press in the search bar.
    $('#search').on('keydown', (e) => {
        if (e.key === 'Enter')
            VSCodeSDFV.getInstance().startFindInGraph();
    });

    $('#breakpoint-btn').on('click', () => {
        VSCodeSDFV.getInstance().toggleBreakpoints();
    });

    window.addEventListener('message', (e) => {
        MessageHandler.getInstance().handleMessage(e.data);
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
