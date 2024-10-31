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
    DagreGraph,
    getGraphElementUUID,
    JsonSDFG,
    LogicalGroup,
    LogicalGroupOverlay,
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    OperationalIntensityOverlay,
    SimulatedOperationalIntensityOverlay,
    parse_sdfg,
    Point2D,
    read_or_decompress,
    RuntimeMicroSecondsOverlay,
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
    ISDFVUserInterface,
    findInGraphPredicate,
    findInGraph,
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
import { SDFVVSCodeUI } from './vscode_sdfv_ui';
import {
    GenericSdfgOverlay,
} from '@spcl/sdfv/src/overlays/generic_sdfg_overlay';

declare const vscode: any;

export class VSCodeSDFV extends SDFV {

    public static readonly DEBUG_DRAW: boolean = false;

    private static readonly INSTANCE: VSCodeSDFV = new VSCodeSDFV();

    private constructor() {
        super();
    }

    public static getInstance(): VSCodeSDFV {
        return this.INSTANCE;
    }

    private readonly UI: SDFVVSCodeUI = SDFVVSCodeUI.getInstance();

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

    public initialize(): void {
        this.initDOM();
        this.UI.init();
        this.initSearch();

        this.refreshSdfg().then(() => {
            this.processingOverlay?.hide();
            SDFVComponent.getInstance().invoke('onReady');
        });
    }

    private initDOM(): void {
        this.processingOverlay = $('#processing-overlay');
        this.processingOverlayMsg = $('#processing-overlay-msg');

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
                        findInGraphPredicate(this.UI, renderer, predicate);
                    }
                }, 1);
            }
            return false;
        });
    }

    public start_find_in_graph(): void {
        this.startFindInGraph();
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
        if (evtype === 'click' || evtype === 'dblclick') {
            this.UI.infoShow();
        } else if (evtype === 'contextmenu') {
            if (VSCodeRenderer.getInstance()?.overlayManager.is_overlay_active(
                LogicalGroupOverlay
            )) {
                VSCodeSDFV.getInstance().handleShowGroupsContextMenu(
                    selectedElements, event
                );
            }

            event.preventDefault();
            return false;
        }

        return false;
    }

    @ICPCRequest()
    public async getCompressedSDFG(): Promise<Uint8Array | null> {
        const sdfgString = this.getSdfgString();
        if (sdfgString)
            return new Uint8Array(gzipSync(sdfgString));
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
                    case 'Consume':
                        icon = 'mediation';
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
                        icon = 'repeat';
                        break;
                    case 'ConditionalBlock':
                        icon = 'alt_route';
                        break;
                    case 'FunctionCallRegion':
                        icon = 'function';
                        break;
                    case 'NamedRegion':
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

    public startFindInGraph(): void {
        const renderer = VSCodeRenderer.getInstance();
        if (renderer)
            setTimeout(() => {
                const searchVal = $('#search').val();
                const graph = renderer.get_graph();
                if (graph && searchVal !== undefined &&
                    typeof searchVal === 'string' && searchVal.length > 0)
                    findInGraph(
                        this.UI, renderer, searchVal,
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
                    this.onMouseEvent.bind(this), null, VSCodeSDFV.DEBUG_DRAW,
                    null, null
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
            this.UI.showElementInfo(
                new SDFG(this.renderer.get_sdfg()), this.renderer
            );

        const renderer = this.renderer;
        renderer.on('selection_changed', () => {
            const selectedElements = renderer.get_selected_elements();
            let element;
            if (selectedElements.length === 0)
                element = new SDFG(renderer.get_sdfg());
            else if (selectedElements.length === 1)
                element = selectedElements[0];
            else
                element = null;

            if (element !== null) {
                this.UI.showElementInfo(element, renderer);
            } else {
                this.UI.infoClear();
                this.UI.infoSetTitle('Multiple elements selected');
            }
            this.UI.infoShow();
        });
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
            this.origSDFG, contentsElem, this.onMouseEvent.bind(this),
            userTransform, VSCodeSDFV.DEBUG_DRAW, null, null
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
            VSCodeRenderer.getInstance()?.overlayManager.get_overlay(
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
        this.UI.infoShow(true);
    }

    @ICPCRequest()
    public updateContents(
        newContent: string | Uint8Array, preventRefreshes: boolean = false
    ): void {
        this.setViewingHistoryState(false);
        $('#exit-preview-button')?.hide();
        const [content, compressed] = read_or_decompress(newContent);
        this.viewingCompressed = compressed;
        this.setRendererContent(content, false, preventRefreshes);
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
                this.UI.infoClear();
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
        const overlayManager = VSCodeRenderer.getInstance()?.overlayManager;

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

    public get linkedUI(): ISDFVUserInterface {
        return this.UI;
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
