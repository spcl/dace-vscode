// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import $ from 'jquery';

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
    Point2D,
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
    GenericSdfgOverlay,
    readOrDecompress,
    parseSDFG,
} from '@spcl/sdfv/src';
import { LViewRenderer } from '@spcl/sdfv/src/local_view/lview_renderer';
import {
    SDFVSettingKey,
    SDFVSettingValT,
    SDFVSettings,
} from '@spcl/sdfv/src/utils/sdfv_settings';
import {
    ICPCRequest,
} from '../../../common/messaging/icpc_messaging_component';
import {
    ICPCWebclientMessagingComponent,
} from '../../messaging/icpc_webclient_messaging_component';
import {
    JsonTransformation,
    JsonTransformationList,
} from '../transformations/transformations';
import { AnalysisController } from './analysis/analysis_controller';
import {
    BreakpointIndicator,
    refreshBreakpoints,
} from './breakpoints/breakpoints';
import { VSCodeRenderer } from './renderer/vscode_renderer';
import {
    clearSelectedTransformation,
    refreshTransformationList,
    refreshXform,
    showTransformationDetails,
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
    zoomToUUIDs,
} from './utils/helpers';
import { ComponentTarget } from '../../../components/components';
import { gzipSync } from 'zlib';
import { SDFVVSCodeUI } from './vscode_sdfv_ui';
import { IOutlineElem, MetaDictT } from '../../../types';
import { WebviewApi } from 'vscode-webview';


declare const vscode: WebviewApi<unknown>;

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

    public static readonly OVERLAYS: Record<
        string, typeof GenericSdfgOverlay
    > = {
            'MemoryVolumeOverlay': MemoryVolumeOverlay,
            'StaticFlopsOverlay': StaticFlopsOverlay,
            'DepthOverlay': DepthOverlay,
            'AvgParallelismOverlay': AvgParallelismOverlay,
            'RuntimeMicroSecondsOverlay': RuntimeMicroSecondsOverlay,
            'BreakpointIndicator': BreakpointIndicator,
            'MemoryLocationOverlay': MemoryLocationOverlay,
            'OperationalIntensityOverlay': OperationalIntensityOverlay,
            'SimulatedOperationalIntensityOverlay':
                SimulatedOperationalIntensityOverlay,
            'LogicalGroupOverlay': LogicalGroupOverlay,
        };

    private processingOverlay?: JQuery;
    private processingOverlayMsg?: JQuery;

    private monaco: unknown = null;
    private origSDFG: JsonSDFG | null = null;
    private sdfgMetaDict: MetaDictT | null = null;
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
            void SDFVComponent.getInstance().invoke('onReady');
        }).catch((reason: unknown) => {
            console.error('Error initializing SDFV:', reason);
            // TODO: show an UI error message.
            this.processingOverlay?.hide();
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
                    const graph = renderer.graph;
                    const code = $('#advsearch').val();
                    if (graph && code) {
                        const predicate = eval(code.toString()) as (
                            graph: DagreGraph, elem: SDFGElement
                        ) => boolean;
                        findInGraphPredicate(this.UI, renderer, predicate);
                    }
                }, 1);
            }
            return false;
        });
    }

    private handleShowGroupsContextMenu(
        selectedElements: SDFGElement[], event: Event
    ): void {
        // If elements are selected, show a context menu to add or remove
        // them to or from logical groups.

        // Ensure that all elements belong to the same SDFG.
        let target: JsonSDFG | null = null;
        for (const elem of selectedElements) {
            if (target === null) {
                target = elem.sdfg;
            } else if (target.cfg_list_id !== elem.sdfg.cfg_list_id) {
                target = null;
                break;
            }
        }

        if (target !== null) {
            const options: {
                label: string | null,
                callback: (() => void) | null,
                disabled: boolean,
            }[] = [];

            // Add options to add elements to groups.
            const attrs = target.attributes as Record<string, unknown>;
            const lGroups = attrs.logical_groups as LogicalGroup[] | undefined;
            for (const lg of lGroups ?? []) {
                options.push({
                    label: `Add selection to group "${lg.name}"`,
                    disabled: false,
                    callback: () => {
                        selectedElements.forEach(el => {
                            if (el instanceof State) {
                                if (!lg.states.includes(el.id))
                                    lg.states.push(el.id);
                            } else if (el.parentStateId !== undefined) {
                                const hasTuple = lg.nodes.some((v) => {
                                    return v[0] === el.parentStateId &&
                                        v[1] === el.id;
                                });
                                if (!hasTuple)
                                    lg.nodes.push([el.parentStateId, el.id]);
                            }
                        });

                        const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                        if (sdfg)
                            void vscodeWriteGraph(sdfg);
                    },
                });
            }

            // Adds a separator.
            if (lGroups) {
                options.push({
                    label: null,
                    disabled: true,
                    callback: null,
                });
            }

            // Add options to remove from groups.
            for (const lg of lGroups ?? []) {
                options.push({
                    label: `Remove selection from group "${lg.name}"`,
                    disabled: false,
                    callback: () => {
                        selectedElements.forEach(el => {
                            if (el instanceof State) {
                                lg.states = lg.states.filter(v => {
                                    return v !== el.id;
                                });
                            } else if (el.parentStateId !== undefined) {
                                lg.nodes = lg.nodes.filter(v => {
                                    return v[0] !== el.parentStateId ||
                                        v[1] !== el.id;
                                });
                            }
                        });

                        const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                        if (sdfg)
                            void vscodeWriteGraph(sdfg);
                    },
                });
            }

            if (options.length > 0) {
                showContextMenu(
                    (event as MouseEvent).clientX,
                    (event as MouseEvent).clientY,
                    options
                );
            }
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
        _sdfv: SDFV,
        _endsPan: boolean
    ): boolean {
        if (evtype === 'contextmenu') {
            if (VSCodeRenderer.getInstance()?.overlayManager.isOverlayActive(
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
    public getCompressedSDFG(): Uint8Array | null {
        const sdfgString = this.getSdfgString();
        if (sdfgString)
            return new Uint8Array(gzipSync(sdfgString));
        return null;
    }

    @ICPCRequest()
    public outline(
        pRenderer?: SDFGRenderer, pGraph?: DagreGraph
    ): void {
        const renderer = pRenderer ?? this.renderer;
        const graph = pGraph ?? renderer?.graph;
        if (!graph || !renderer)
            return;

        const outlineList = [];

        const topLevelSDFG: IOutlineElem = {
            icon: 'res:icons/sdfg.svg',
            type: 'SDFG',
            label: `SDFG ${renderer.sdfg?.attributes?.name ?? ''}`,
            collapsed: false,
            uuid: getGraphElementUUID(undefined),
            children: [],
        };
        outlineList.push(topLevelSDFG);

        const stack: (IOutlineElem | undefined)[] = [topLevelSDFG];

        traverseSDFGScopes(
            graph, (node) => {
                // Skip exit nodes when scopes are known.
                if (node.type.endsWith('Exit') &&
                    (node.jsonData?.scope_entry ?? -1) as number >= 0) {
                    stack.push(undefined);
                    return true;
                }

                // Create an entry.
                const isCollapsed = (
                    node.attributes()?.is_collapsed as boolean | undefined ??
                    false
                );
                const nodeLabel = node.type === 'NestedSDFG' ?
                    node.jsonData?.label as string : node.label;

                // If scope has children, remove the name "Entry" from the type.
                let nodeType = node.type;
                if (nodeType.endsWith('Entry')) {
                    const state = node.parentStateId !== undefined ?
                        (node.cfg?.nodes[node.parentStateId] as
                                JsonSDFGState | undefined) ??  null : null;
                    if (state?.scope_dict?.[node.id])
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
                    icon: icon,
                    type: nodeType,
                    label: nodeLabel,
                    collapsed: isCollapsed,
                    uuid: getGraphElementUUID(node),
                    children: [],
                });

                // If the node's collapsed we don't traverse any further.
                if (isCollapsed)
                    return false;
                return true;
            }, () => {
                // After scope ends, pop ourselves as the current element and
                // add outselves to the parent.
                const elem = stack.pop();
                const elemParent = stack[stack.length - 1];
                if (elem !== undefined && elemParent !== undefined)
                    elemParent.children.push(elem);
            }
        );

        void SDFVComponent.getInstance().invoke(
            'setOutline', [outlineList], ComponentTarget.Outline
        );
    }

    public startFindInGraph(): void {
        const renderer = VSCodeRenderer.getInstance();
        if (renderer) {
            setTimeout(() => {
                const searchVal = $('#search').val();
                const graph = renderer.graph;
                if (graph && searchVal !== undefined &&
                    typeof searchVal === 'string' && searchVal.length > 0) {
                    findInGraph(
                        this.UI, renderer, searchVal,
                        $('#search-case').is(':checked')
                    );
                }
            }, 1);
        }
    }

    public async refreshSdfg(): Promise<void> {
        return SDFVComponent.getInstance().invoke<string | ArrayBuffer>(
            'getUpToDateContents'
        ).then(sdfg => {
            this.updateContents(sdfg);
        });
    }

    public async setRendererContent(
        sdfg: string | JsonSDFG, previewing: boolean = false,
        preventRefreshes: boolean = false
    ): Promise<void> {
        const parsedSdfg = typeof sdfg === 'string' ?
            checkCompatLoad(parseSDFG(sdfg)) : checkCompatLoad(sdfg);
        if (!this.renderer) {
            const contentsElem = document.getElementById('contents');
            if (contentsElem === null) {
                console.error('Could not find element to attach renderer to');
                return;
            }

            this._renderer = VSCodeRenderer.init(
                parsedSdfg, contentsElem,
                this.onMouseEvent.bind(this), null, VSCodeSDFV.DEBUG_DRAW,
                null
            );
        }
        const renderer = this.renderer!;
        await renderer.setSDFG(parsedSdfg);

        if (!previewing) {
            this.origSDFG = parsedSdfg;
            if (!preventRefreshes) {
                refreshXform(this).catch(console.error);
                this.resyncTransformationHistory().catch(console.error);
            }
        }

        if (!preventRefreshes) {
            const graph = renderer.graph;
            if (graph)
                this.outline(renderer, graph);
            AnalysisController.getInstance().refreshAnalysisPane();
            refreshBreakpoints();
        }

        const selectedElements = renderer.selectedRenderables;
        if (selectedElements.size === 1)
            reselectRendererElement(Array.from(selectedElements)[0]);

        renderer.on('selection_changed', () => {
            const selectedElements = renderer.selectedRenderables;
            let element;
            if (selectedElements.size === 0 && renderer.sdfg) {
                element = new SDFG(
                    renderer, renderer.ctx, renderer.minimapCtx, renderer.sdfg
                );
            } else if (selectedElements.size === 1) {
                element = Array.from(selectedElements)[0];
            } else {
                element = null;
            }

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
            userTransform = renderer.canvasManager.getUserTransform();
            renderer.destroy();
        }

        const contentsElem = document.getElementById('contents');
        if (contentsElem === null) {
            console.error('Could not find element to attach renderer to');
            return;
        }

        renderer = VSCodeRenderer.init(
            this.origSDFG, contentsElem, this.onMouseEvent.bind(this),
            userTransform, VSCodeSDFV.DEBUG_DRAW, null
        );

        if (renderer.graph) {
            this.outline(renderer, renderer.graph);
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
        await SDFVComponent.getInstance().invoke(
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
        await SDFVComponent.getInstance().invoke(
            'goToCPP', [sdfgName, sdfgId, stateId, nodeId]
        );
    }

    public toggleBreakpoints(): void {
        this.setShowingBreakpoints(!this.showingBreakpoints);
    }

    public getMonaco(): unknown {
        return this.monaco;
    }

    public async getMetaDict(): Promise<MetaDictT> {
        if (!this.sdfgMetaDict) {
            // If SDFG property metadata isn't available, use the static one and
            // query an up-to-date one from the dace github page. If that
            // doesn't work, query the daemon.
            this.queryMetaDictFunc ??= new Promise((resolve) => {
                SDFVComponent.getInstance().invoke<MetaDictT | undefined>(
                    'querySdfgMetadata', undefined, ComponentTarget.DaCe
                ).then(metaDict => {
                    if (metaDict) {
                        resolve(metaDict);
                        return;
                    }

                    fetch(
                        'https://spcl.github.io/dace/metadata/' +
                            'minified.sdfg_meta_dict.json'
                    ).then((response) => {
                        resolve(response.json());
                    }).catch(() => {
                        // If the fetch fails, use the static one.
                        resolve(staticSdfgMetaDict);
                    });
                }).catch(() => {
                    // Something went wrong, try fetching from the web.
                    fetch(
                        'https://spcl.github.io/dace/metadata/' +
                            'minified.sdfg_meta_dict.json'
                    ).then((response) => {
                        resolve(response.json());
                    }).catch(() => {
                        // If the fetch fails, use the static one.
                        resolve(staticSdfgMetaDict);
                    });
                });
            });

            return this.queryMetaDictFunc.then((data) => {
                this.sdfgMetaDict = data;
                this.queryMetaDictFunc = null;
                return this.sdfgMetaDict;
            }).catch((reason: unknown) => {
                console.error(reason);
                this.sdfgMetaDict = staticSdfgMetaDict;
                this.queryMetaDictFunc = null;
                return this.sdfgMetaDict;
            });
        }
        return this.sdfgMetaDict;
    }

    public getCachedMetaDict(): MetaDictT | null {
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

    public setMonaco(monaco: unknown): void {
        this.monaco = monaco;
    }

    public getSdfgString(): string | null {
        const sdfg = this.renderer?.sdfg;
        if (sdfg) {
            unGraphiphySdfg(sdfg);
            const sdfgString = JSON.stringify(sdfg, (_k, v) => {
                return v === undefined ? null : v as unknown;
            }, 2);
            return sdfgString;
        }
        return null;
    }

    @ICPCRequest()
    public setMetaDict(sdfgMetaDict: Record<string, any> | null): void {
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
            VSCodeRenderer.getInstance()?.overlayManager.getOverlay(
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

    public setRenderer(renderer: SDFGRenderer | undefined): void {
        if (renderer) {
            this.localViewRenderer?.destroy();
            this._localViewRenderer = undefined;
        }
        this._renderer = renderer;
    }

    public setLocalViewRenderer(
        localViewRenderer: LViewRenderer | undefined
    ): void {
        if (localViewRenderer)
            this.renderer?.destroy();
        this._localViewRenderer = localViewRenderer;
        this.UI.infoShow(true);
    }

    @ICPCRequest()
    public updateContents(
        newContent: string | ArrayBuffer, preventRefreshes: boolean = false
    ): void {
        this.setViewingHistoryState(false);
        $('#exit-preview-button').hide();
        const [content, compressed] = readOrDecompress(newContent);
        this.viewingCompressed = compressed;
        this.setRendererContent(
            content, false, preventRefreshes
        ).catch(console.error);
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
    public async previewSdfg(
        pSdfg?: string, histIndex: number | undefined = undefined,
        refresh: boolean = false
    ): Promise<void> {
        if (pSdfg) {
            await this.setRendererContent(pSdfg, true);
            $('#exit-preview-button').show();
            if (histIndex !== undefined) {
                this.UI.infoClear();
                this.setViewingHistoryState(true, histIndex);
                await refreshTransformationList();
            }
        } else {
            // No SDFG provided, exit preview.
            this.resetRendererContent();
            this.setViewingHistoryState(false);
            $('#exit-preview-button').hide();
            if (refresh)
                await refreshTransformationList();
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
    public selectTransformation(transformation: JsonTransformation): void {
        showTransformationDetails(transformation);
        this.setSelectedTransformation(transformation);
    }

    @ICPCRequest()
    public async resyncTransformationHistory(): Promise<void> {
        const sdfg = this.renderer?.sdfg;
        if (sdfg) {
            const transformationHistory = (jsonSDFGElemReadAttr(
                sdfg, 'transformation_hist'
            ) ?? []) as JsonTransformation[];
            await SDFVComponent.getInstance().invoke(
                'setHistory',
                [transformationHistory, this.viewingHistoryIndex],
                ComponentTarget.History
            );
        }
    }

    @ICPCRequest()
    public async toggleCollapseFor(uuid: string): Promise<void> {
        const renderer = this.renderer;
        const cfgList = renderer?.cfgList;
        if (renderer && cfgList) {
            const [elem, _] = findJsonSDFGElementByUUID(cfgList, uuid);
            if (elem && isCollapsible(elem)) {
                elem.attributes ??= {};
                elem.attributes.is_collapsed = !jsonSDFGElemReadAttr(
                    elem, 'is_collapsed'
                );
                renderer.emit('collapse_state_changed');
                await renderer.layout();
                renderer.drawAsync();
            }
        }
    }

    @ICPCRequest()
    public setOverlays(overlays: string[]): void {
        const overlayManager = VSCodeRenderer.getInstance()?.overlayManager;

        const toActivate = [];
        for (const ol of overlays)
            toActivate.push(VSCodeSDFV.OVERLAYS[ol]);

        // Deregister any previously active overlays.
        overlayManager?.deregisterAll(toActivate);

        // Register all the selected overlays.
        for (const ol of toActivate) {
            if (!overlayManager?.isOverlayActive(ol))
                overlayManager?.registerOverlay(ol);
        }
    }

    @ICPCRequest()
    public async specialize(valueMap: SymbolMap): Promise<void> {
        this.setProcessingOverlay(true, 'Specializing');
        const specialized = await SDFVComponent.getInstance().invoke(
            'specializeGraph',
            [this.getSdfgString(), valueMap], ComponentTarget.DaCe
        ) as JsonSDFG;
        await this.setRendererContent(specialized, false, false);
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
        this.invoke<Map<SDFVSettingKey, SDFVSettingValT>>(
            'getSettings', [SDFVSettings.settingsKeys]
        ).then(settings => {
            for (const [k, v] of Object.entries(settings))
                SDFVSettings.set(k as SDFVSettingKey, v);
            sdfv.initialize();
            sdfv.renderer?.drawAsync();
        }).catch((reason: unknown) => {
            console.error('Error loading SDFV settings:', reason);
            // TODO: show an UI error message.
        });
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
            renderer.drawAsync();
        }
    };

    $('body').show();
});
