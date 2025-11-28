// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    AvgParallelismOverlay,
    DepthOverlay,
    EntryNode,
    findGraphElementByUUID,
    JsonSDFG,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGNode,
    JsonSDFGState,
    ModeButtons,
    OperationalIntensityOverlay,
    SDFGElementType,
    SDFGRenderer,
    setPositioningInfo,
    SimulatedOperationalIntensityOverlay,
    StaticFlopsOverlay,
} from '@spcl/sdfv/src';
import { memletTreeComplete } from '@spcl/sdfv/src/utils/sdfg/memlet_trees';
import { ComponentTarget } from '../../../../components/components';
import { MetaDictT } from '../../../../types';
import { AnalysisController } from '../analysis/analysis_controller';
import {
    refreshTransformationList,
    refreshXform,
    sortTransformations,
} from '../transformation/transformation';
import {
    createSingleUseModal,
    findJsonSDFGElementByUUID,
    findMaximumSdfgId,
    vscodeWriteGraph,
} from '../utils/helpers';
import {
    SDFVComponent,
    VSCodeSDFV,
} from '../vscode_sdfv';
import { SDFVVSCodeUI } from '../vscode_sdfv_ui';


export class VSCodeRenderer extends SDFGRenderer {

    private static INSTANCE: VSCodeRenderer | null = null;

    public static getInstance(): VSCodeRenderer | null {
        return this.INSTANCE;
    }

    protected _daemonConnected: boolean = false;

    public static init(
        sdfg: JsonSDFG,
        container: HTMLElement,
        onMouseEvent: ((...args: any[]) => boolean) | null | undefined = null,
        userTransform: DOMMatrix | null | undefined = null,
        debugDraw: boolean | undefined = false,
        backgroundColor: string | null | undefined = null,
        modeButtons?: ModeButtons
    ): VSCodeRenderer {
        if (this.INSTANCE)
            this.INSTANCE.destroy();
        this.INSTANCE = new VSCodeRenderer(
            VSCodeSDFV.getInstance(), sdfg, container, onMouseEvent,
            userTransform, debugDraw, backgroundColor, modeButtons
        );
        VSCodeSDFV.getInstance().setRenderer(this.INSTANCE);

        this.INSTANCE.on(
            'add_element',
            this.INSTANCE.addNodeToGraph.bind(this.INSTANCE)
        );
        this.INSTANCE.on(
            'query_libnode',
            this.INSTANCE.showSelectLibraryNodeDialog.bind(this.INSTANCE)
        );
        this.INSTANCE.on(
            'active_overlays_changed',
            AnalysisController.getInstance().refreshAnalysisPane.bind(
                AnalysisController.getInstance()
            )
        );
        this.INSTANCE.on('exit_preview', () => {
            SDFVComponent.getInstance().invoke<string | ArrayBuffer>(
                'getUpToDateContents'
            ).then(sdfg => {
                VSCodeSDFV.getInstance().updateContents(sdfg, true);
                SDFVComponent.getInstance().invoke(
                    'setHistory',
                    [
                        VSCodeRenderer.getInstance()?.sdfg?.attributes
                            ?.transformation_hist,
                        VSCodeSDFV.getInstance().getViewingHistoryIndex(),
                    ],
                    ComponentTarget.History
                ).catch((err: unknown) => {
                    console.error(
                        'Could not update history panel:', err
                    );
                });
            }).catch((err: unknown) => {
                console.error(
                    'Could not retrieve up-to-date SDFG contents:', err
                );
            });
        });
        this.INSTANCE.on(
            'graph_edited',
            this.INSTANCE.sendNewSdfgToVscode.bind(this.INSTANCE)
        );
        this.INSTANCE.on('selection_changed', multSelectionChanged => {
            if (multSelectionChanged) {
                refreshXform(VSCodeSDFV.getInstance()).catch((err: unknown) => {
                    console.error(
                        'Could not refresh transformation panel:', err
                    );
                });
            } else {
                sortTransformations(false, refreshTransformationList, true);
            }
        });
        this.INSTANCE.on('backend_data_requested', (type, overlay) => {
            switch (type) {
                case 'flops':
                    SDFVComponent.getInstance().invoke(
                        'getFlops', [], ComponentTarget.DaCe
                    ).then((flopsMap) => {
                        if (!flopsMap)
                            return;
                        const renderer = VSCodeRenderer.getInstance();
                        const oType = VSCodeSDFV.OVERLAYS[overlay];
                        const ol = renderer?.overlayManager.getOverlay(oType);
                        (ol as
                            StaticFlopsOverlay |
                            OperationalIntensityOverlay
                        ).updateFlopsMap(flopsMap);
                    }).catch((err: unknown) => {
                        console.error('Could not retrieve FLOPs data:', err);
                    });
                    break;
                case 'depth':
                    SDFVComponent.getInstance().invoke(
                        'getDepth', [], ComponentTarget.DaCe
                    ).then((depthMap) => {
                        if (!depthMap)
                            return;
                        const renderer = VSCodeRenderer.getInstance();
                        const oType = VSCodeSDFV.OVERLAYS[overlay];
                        const ol = renderer?.overlayManager.getOverlay(oType);
                        (ol as
                            DepthOverlay
                        ).updateDepthMap(depthMap);
                    }).catch((err: unknown) => {
                        console.error('Could not retrieve FLOPs data:', err);
                    });
                    break;
                case 'avg_parallelism':
                    SDFVComponent.getInstance().invoke(
                        'getAvgParallelism', [], ComponentTarget.DaCe
                    ).then((avgParallelismMap) => {
                        if (!avgParallelismMap)
                            return;
                        const renderer = VSCodeRenderer.getInstance();
                        const oType = VSCodeSDFV.OVERLAYS[overlay];
                        const ol = renderer?.overlayManager.getOverlay(oType);
                        (ol as
                            AvgParallelismOverlay
                        ).updateAvgParallelismMap(avgParallelismMap);
                    }).catch((err: unknown) => {
                        console.error('Could not retrieve FLOPs data:', err);
                    });
                    break;
                case 'op_in':
                    SDFVComponent.getInstance().invoke(
                        'getOperationalIntensity', [], ComponentTarget.DaCe
                    ).then((opInMap) => {
                        if (!opInMap)
                            return;
                        const renderer = VSCodeRenderer.getInstance();
                        const oType = VSCodeSDFV.OVERLAYS[overlay];
                        const ol = renderer?.overlayManager.getOverlay(oType);
                        (ol as
                            SimulatedOperationalIntensityOverlay
                        ).updateOpIntMap(opInMap);
                    }).catch((err: unknown) => {
                        console.error('Could not retrieve FLOPs data:', err);
                    });
                    break;
            }
        });
        this.INSTANCE.on('settings_changed', (settings) => {
            const nSettings: Record<string, any> = {};
            for (const [k, v] of settings.entries())
                nSettings[k] = v;
            SDFVComponent.getInstance().invoke(
                'updateSettings', [nSettings]
            ).catch((err: unknown) => {
                console.error('Could not update settings:', err);
            });
        });

        SDFVVSCodeUI.getInstance().registerExpandInfoButton();

        return this.INSTANCE;
    }

    public destroy(): void {
        super.destroy();
    }

    public async setSDFG(sdfg: JsonSDFG, layout?: boolean): Promise<void> {
        return super.setSDFG(sdfg, layout).then(() => {
            // TODO(later): This is a fix for broken memlet trees when the graph
            // is changed / edited (including when the collapse state changes).
            // This is only necessary because these type of events send changes
            // to the underlying document, which in turn updates the webview
            // with the same contents to ensure the two representations are kept
            // in sync. This needs to be handled better, i.e. _without_
            // requiring this two-sided update, which causes slowdowns when the
            // graph is edited.
            this.allMemletTressSDFG = memletTreeComplete(this.sdfg!);
            this.updateFastMemletLookup();
        });
    }

    private constructor(
        sdfv: VSCodeSDFV,
        sdfg: JsonSDFG,
        container: HTMLElement,
        onMouseEvent: ((...args: any[]) => boolean) | null | undefined = null,
        userTransform: DOMMatrix | null | undefined = null,
        debugDraw: boolean | undefined = false,
        backgroundColor: string | null | undefined = null,
        modeButtons?: ModeButtons
    ) {
        if (!modeButtons) {
            const panButton =
                $('#pan-btn') as JQuery<HTMLButtonElement> | undefined;
            const moveButton =
                $('#move-btn') as JQuery<HTMLButtonElement> | undefined;
            const selectButton =
                $('#select-btn') as JQuery<HTMLButtonElement> | undefined;
            const addButtons: JQuery<HTMLButtonElement>[] = [];

            const ids = [
                'elem_access_node',
                'elem_map',
                'elem_consume',
                'elem_tasklet',
                'elem_nested_sdfg',
                'elem_libnode',
                'elem_state',
                'elem_edge',
            ];

            for (const id of ids) {
                const elem =
                    $('#' + id) as JQuery<HTMLButtonElement> | undefined;
                if (elem)
                    addButtons.push(elem);
            }

            if (panButton && moveButton && selectButton) {
                modeButtons = {
                    pan: panButton,
                    move: moveButton,
                    select: selectButton,
                    addBtns: addButtons,
                };
            }
        }

        super(
            container, sdfv, onMouseEvent, userTransform, debugDraw,
            backgroundColor, modeButtons
        );
    }

    public async cutoutSelection(
        suppressSave: boolean = false
    ): Promise<void> {
        await super.cutoutSelection();
        // Ensure that cutouts are registered as graph edits.
        if (!suppressSave && this.sdfg)
            await vscodeWriteGraph(this.sdfg);
    }

    public async localViewSelection(): Promise<void> {
        await super.localViewSelection();
    }

    public async exitLocalView(): Promise<void> {
        await VSCodeSDFV.getInstance().refreshSdfg();
    }

    public async sendNewSdfgToVscode(): Promise<void> {
        if (this.sdfg)
            await vscodeWriteGraph(this.sdfg);
    }

    public async addNodeToGraph(
        addType: SDFGElementType, parentUUID: string, lib?: string,
        edgeStartUUID?: string, edgeStartConn?: string, edgeDstConn?: string
    ): Promise<void> {
        const metaDict = await VSCodeSDFV.getInstance().getMetaDict();
        const meta = metaDict[addType] as MetaDictT;

        const rootSdfg = VSCodeRenderer.getInstance()?.sdfg;
        if (!rootSdfg)
            return;

        let addRoot = undefined;
        if (addType === SDFGElementType.Edge && edgeStartUUID) {
            const [startElem, startElemSdfg] =
                findJsonSDFGElementByUUID(this.cfgList, edgeStartUUID);
            const [endElem, endElemSdfg] =
                findJsonSDFGElementByUUID(this.cfgList, parentUUID);
            let edge: JsonSDFGEdge | undefined = undefined;
            if (startElemSdfg.cfg_list_id === endElemSdfg.cfg_list_id &&
                startElem && endElem) {
                const startId = startElem.id?.toString() ?? '0';
                const endId = endElem.id?.toString() ?? '0';
                if (startElem.type === SDFGElementType.SDFGState.toString()) {
                    edge  = {
                        type: 'Edge',
                        src: startId,
                        dst: endId,
                        height: 0,
                        width: 0,
                        attributes: {
                            data: {
                                type: 'InterstateEdge',
                                attributes: {},
                                label: '',
                            },
                        },
                    };
                    const iseMeta = metaDict.InterstateEdge as MetaDictT;
                    for (const key in iseMeta) {
                        const attrs = edge.attributes!.data!.attributes!;
                        if (attrs[key] === undefined) {
                            const val = iseMeta[key] as MetaDictT;
                            attrs[key] = val.default;
                        }
                    }
                    addRoot = startElemSdfg;
                } else {
                    const parentIdParts = parentUUID.split('/');
                    const parentStateId =
                        parentIdParts[0] + '/' + parentIdParts[1];
                    const parentState = findJsonSDFGElementByUUID(
                        this.cfgList, parentStateId
                    )[0] as JsonSDFGState | undefined;
                    if (parentState) {
                        edge = {
                            type: 'MultiConnectorEdge',
                            src: startId,
                            dst: endId,
                            src_connector: edgeStartConn,
                            dst_connector: edgeDstConn,
                            height: 0,
                            width: 0,
                            attributes: {
                                data: {
                                    type: 'Memlet',
                                    attributes: {},
                                },
                            },
                        };
                        const mceMeta = metaDict.Memlet as MetaDictT;
                        for (const key in mceMeta) {
                            const attrs = edge.attributes!.data!.attributes!;
                            if (attrs[key] === undefined) {
                                const val = mceMeta[key] as MetaDictT;
                                attrs[key] = val.default;
                            }
                        }
                        addRoot = parentState;
                    }
                }
            } else {
                edge = undefined;
            }

            if (edge && addRoot && 'edges' in addRoot) {
                const graphElem = addRoot;
                graphElem.edges.push(edge);
                this.addElementPosition = undefined;
                this.addEdgeStart = undefined;

                await this.setSDFG(rootSdfg);

                await vscodeWriteGraph(rootSdfg);
            }
        } else {
            const [parentElem, parentSdfg] = findJsonSDFGElementByUUID(
                this.cfgList, parentUUID
            );

            const parent = parentElem ?? rootSdfg;

            if ('nodes' in parent) {
                const graphElem =
                    parent as JsonSDFGState | JsonSDFGControlFlowRegion;
                let maxId = -1;
                for (const el of graphElem.nodes)
                    maxId = Math.max(maxId, el.id);
                let element: JsonSDFGNode | undefined = {
                    label: '',
                    id: maxId + 1,
                    type: addType,
                    attributes: {},
                };
                let exitElem: JsonSDFGNode | undefined = undefined;
                switch (addType) {
                    case SDFGElementType.SDFGState:
                        element.collapsed = false;
                        element.edges = [];
                        element.nodes = [];
                        element.scope_dict = {};
                        element.label = 'New State';
                        break;
                    case SDFGElementType.AccessNode:
                        {
                            const arrays = parentSdfg.attributes?._arrays ?
                                Object.keys(parentSdfg.attributes._arrays) : [];
                            const data = arrays[0];
                            if (element.attributes)
                                element.attributes.data = data;
                            element.label = data;
                        }
                        break;
                    case SDFGElementType.Tasklet:
                        element.label = 'New Tasklet';
                        break;
                    case SDFGElementType.NestedSDFG:
                        {
                            const maxSdfgId = findMaximumSdfgId(rootSdfg);
                            const nSdfgState: JsonSDFGState = {
                                collapsed: false,
                                edges: [],
                                nodes: [],
                                scope_dict: {},
                                label: 'New State',
                                id: 0,
                                attributes: {},
                                type: SDFGElementType.SDFGState,
                            };
                            const stateMeta = metaDict[
                                SDFGElementType.SDFGState
                            ] as MetaDictT;
                            for (const key in stateMeta) {
                                if (nSdfgState.attributes![key] === undefined) {
                                    const val = stateMeta[key] as MetaDictT;
                                    nSdfgState.attributes![key] = val.default;
                                }
                            }
                            const newSDFGId = maxSdfgId + 1;
                            const nSdfg: JsonSDFG = {
                                attributes: {
                                    _arrays: {},
                                    symbols: {},
                                    name: 'NewSDFG',
                                },
                                label: 'NewSDFG',
                                collapsed: false,
                                nodes: [nSdfgState],
                                edges: [],
                                start_block: 0,
                                type: 'SDFG',
                                error: undefined,
                                cfg_list_id: newSDFGId,
                                id: newSDFGId,
                            };
                            const sdfgMeta = metaDict.SDFG as MetaDictT;
                            for (const key in sdfgMeta) {
                                if (nSdfg.attributes![key] === undefined) {
                                    const val = sdfgMeta[key] as MetaDictT;
                                    nSdfg.attributes![key] = val.default;
                                }
                            }
                            element.label = 'New Nested SDFG';
                            if (element.attributes)
                                element.attributes.sdfg = nSdfg;
                        }
                        break;
                    case SDFGElementType.MapEntry:
                        {
                            element.label = 'New Map';
                            element.scope_entry = undefined;
                            element.scope_exit = String(element.id + 1);
                            exitElem = {
                                attributes: {},
                                id: element.id + 1,
                                label: element.label,
                                type: SDFGElementType.MapExit,
                                scope_entry: String(element.id),
                                scope_exit: String(element.id),
                            };
                            const exitMeta = metaDict[
                                SDFGElementType.MapExit
                            ] as MetaDictT;
                            for (const key in exitMeta) {
                                if (exitElem.attributes?.[key] === undefined) {
                                    const val = exitMeta[key] as MetaDictT;
                                    exitElem.attributes![key] = val.default;
                                }
                            }
                        }
                        break;
                    case SDFGElementType.ConsumeEntry:
                        {
                            element.label = 'New Consume';
                            element.scope_entry = undefined;
                            element.scope_exit = String(element.id + 1);
                            exitElem = {
                                attributes: {},
                                id: element.id + 1,
                                label: element.label,
                                type: SDFGElementType.ConsumeExit,
                                scope_entry: String(element.id),
                                scope_exit: String(element.id + 1),
                            };
                            const exitMeta = metaDict[
                                SDFGElementType.ConsumeExit
                            ] as MetaDictT;
                            for (const key in exitMeta) {
                                if (exitElem.attributes?.[key] === undefined) {
                                    const val = exitMeta[key] as MetaDictT;
                                    exitElem.attributes![key] = val.default;
                                }
                            }
                        }
                        break;
                    case SDFGElementType.LibraryNode:
                        if (lib) {
                            const libParts = lib.split('.');
                            const libName = libParts[libParts.length - 1];
                            element.label = libName;
                            element.classpath = lib;
                        } else {
                            element = undefined;
                        }
                        break;
                    default:
                        element = undefined;
                        break;
                }

                if (element) {
                    for (const key in meta) {
                        if (element.attributes?.[key] === undefined) {
                            const val = meta[key] as MetaDictT;
                            element.attributes![key] = val.default;
                        }
                    }

                    const parentState = graphElem as JsonSDFGState;
                    if (addType.endsWith('Entry') && parentState.scope_dict &&
                        exitElem) {
                        parentState.scope_dict[element.id] = [exitElem.id];
                        const parentScope = parentState.scope_dict['-1'];
                        if (parentScope)
                            parentScope.push(element.id);
                        else
                            parentState.scope_dict['-1'] = [element.id];
                    } else if (addType !== SDFGElementType.SDFGState &&
                        parentState.scope_dict) {
                        element.scope_entry = undefined;
                        element.scope_exit = undefined;
                        const parentScope = parentState.scope_dict['-1'];
                        if (parentScope)
                            parentScope.push(element.id);
                        else
                            parentState.scope_dict['-1'] = [element.id];
                    }

                    parentState.nodes.push(element);
                    if (exitElem)
                        parentState.nodes.push(exitElem);

                    setPositioningInfo(element, {
                        dx: this.addElementPosition?.x,
                        dy: this.addElementPosition?.y,
                    });
                    this.addElementPosition = undefined;

                    await this.setSDFG(rootSdfg);

                    await vscodeWriteGraph(rootSdfg);
                }
            }
        }
    }

    /**
     * Set the correct poisiton for newly added graph elements.
     * This is called as a callback after a new element has been added to the
     * graph and uses a previously stored adding poistion to correctly
     * position the newly added element.
     */
    public updateNewElement(uuids: string[]): void {
        if (!this.addElementPosition || !this.graph)
            return;

        const first = uuids[0];

        if (first === 'NONE')
            return;

        const el = findGraphElementByUUID(this.cfgList, first);
        if (!el)
            return;

        this.translateElement(
            el, this.graph, { x: el.x, y: el.y }, this.addElementPosition, true
        );

        if (el instanceof EntryNode && uuids.length >= 2) {
            const exit = findGraphElementByUUID(this.cfgList, uuids[1]);
            if (exit) {
                this.translateElement(
                    exit, this.graph, { x: exit.x, y: exit.y },
                    {
                        x: this.addElementPosition.x,
                        y: this.addElementPosition.y + 100,
                    },
                    true
                );
            }
        }

        this.addElementPosition = undefined;

        this.sendNewSdfgToVscode().catch(console.error);
    }

    public showNoDaemonDialog(): void {
        const modalRet = createSingleUseModal(
            'No DaCe Daemon', false, ''
        );
        modalRet.body.append($('<p>', {
            'text': 'You need to open the SDFG Optimization sidepanel to ' +
                'add SDFG elements or edit SDFG properties',
        }));
        modalRet.modal.show();
    }

    public showSelectLibraryNodeDialog(callback: () => unknown): void {
        VSCodeSDFV.getInstance().getMetaDict().then(sdfgMetaDict => {
            const modalRet = createSingleUseModal(
                'Select Library Node', true, ''
            );

            const libraries = sdfgMetaDict.__libs__ as Record<string, string>;

            const container = $('<div>', {
                'class': 'container-fluid',
            }).appendTo(modalRet.body);

            const row = $('<div>', {
                'class': 'row',
            }).appendTo(container);

            const headerWrapper = $('<div>', {
                'class': 'col-3',
            }).appendTo(row);
            $('<span>', {
                'text': 'Library:',
            }).appendTo(headerWrapper);

            const libInputWrapper = $('<div>', {
                'class': 'col-9',
            }).appendTo(row);
            const libInput = $('<select>', {
                'id': 'lib-selection-input-list',
                'class': 'sdfv-property-dropdown',
                'style': 'width: 100%;',
                'placeholder': 'Type to search...',
            }).appendTo(libInputWrapper);

            Object.keys(libraries).forEach(libname => {
                libInput.append(new Option(
                    libname,
                    libraries[libname],
                    false,
                    false
                ));
            });

            libInput.editableSelect({
                filter: false,
                effects: 'fade',
                duration: 'fast',
            });

            const backgroundLibInput = $('#lib-selection-input-list');

            modalRet.confirmBtn?.on('click', () => {
                const libInputVal = backgroundLibInput.val();
                if (libInputVal && typeof libInputVal === 'string') {
                    callback();
                    this.addModeLib = libraries[libInputVal];
                    modalRet.modal.hide();
                } else {
                    backgroundLibInput.addClass('is-invalid');
                }
            });

            modalRet.modal.show();
        }).catch(() => {
            console.error('Could not retrieve SDFG meta dictionary');
        });
    }

    public clearSelectedItems(): void {
        this.clearSelected();
    }

    public setDaemonConnected(connected: boolean): void {
        this._daemonConnected = connected;
    }

}
