// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    SDFGRenderer,
    JsonSDFG,
    ModeButtons,
    EntryNode,
    ExitNode,
    get_uuid_graph_element,
    find_graph_element_by_uuid,
    SDFGElement,
    set_positioning_info,
    SDFGElementType,
    JsonSDFGState,
} from '@spcl/sdfv/out';
import {
    createSingleUseModal,
    findJsonSDFGElementByUUID,
    findMaximumSdfgId,
    unGraphiphySdfg,
    vscodeWriteGraph,
} from '../utils/helpers';
import {
    vscodeHandleEvent,
    VSCodeSDFV,
} from '../vscode_sdfv';

declare const vscode: any;

export class VSCodeRenderer extends SDFGRenderer {

    private static INSTANCE: VSCodeRenderer | null = null;

    public static getInstance(): VSCodeRenderer | null {
        return this.INSTANCE;
    }

    public static init(
        sdfg: JsonSDFG,
        container: HTMLElement,
        onMouseEvent: ((...args: any[]) => boolean) | null | undefined = null,
        userTransform: DOMMatrix | null | undefined = null,
        debugDraw: boolean | undefined = false,
        backgroundColor: string | null | undefined = null,
        modeButtons: ModeButtons | null = null
    ): VSCodeRenderer {
        if (this.INSTANCE)
            this.INSTANCE.destroy();
        this.INSTANCE = new VSCodeRenderer(
            VSCodeSDFV.getInstance(), sdfg, container, onMouseEvent,
            userTransform, debugDraw, backgroundColor, modeButtons
        );
        VSCodeSDFV.getInstance().set_renderer(this.INSTANCE);
        this.INSTANCE.register_ext_event_handler(vscodeHandleEvent);
        return this.INSTANCE;
    }

    public destroy(): void {
        super.destroy();
    }

    private constructor(
        sdfv: VSCodeSDFV,
        sdfg: JsonSDFG,
        container: HTMLElement,
        onMouseEvent: ((...args: any[]) => boolean) | null | undefined = null,
        userTransform: DOMMatrix | null | undefined = null,
        debugDraw: boolean | undefined = false,
        backgroundColor: string | null | undefined = null,
        modeButtons: ModeButtons | null = null
    ) {
        if (!modeButtons) {
            const panButton = document.getElementById('pan-btn');
            const moveButton = document.getElementById('move-btn');
            const selectButton = document.getElementById('select-btn');
            const addButtons: HTMLElement[] = [];

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
                const elem = document.getElementById(id);
                if (elem)
                    addButtons.push(elem);
            }

            if (panButton && moveButton && selectButton)
                modeButtons = {
                    pan: panButton,
                    move: moveButton,
                    select: selectButton,
                    add_btns: addButtons,
                };
        }

        super(
            sdfv, sdfg, container, onMouseEvent, userTransform, debugDraw,
            backgroundColor, modeButtons
        );
    }

    public async localViewSelection(): Promise<void> {
        await super.localViewSelection();
        // Hide the info button so the local view controls cannot be disabled
        // by accident.
        $('#info-clear-btn').hide();
    }

    public exitLocalView(): void {
        VSCodeSDFV.getInstance().refreshSdfg();
    }

    public sendNewSdfgToVscode(): void {
        vscodeWriteGraph(this.sdfg);
    }

    public addNodeToGraph(
        addType: SDFGElementType, parentUUID: string, lib: string | null = null,
        edgeStartUUID: string | null = null
    ): void {
        const meta = VSCodeSDFV.getInstance().getMetaDict()[addType];

        const rootSdfg = VSCodeRenderer.getInstance()?.get_sdfg();
        if (!rootSdfg)
            return;

        let addRoot = undefined;
        if (addType === SDFGElementType.Edge && edgeStartUUID) {
            const [startElem, startElemSdfg] =
                findJsonSDFGElementByUUID(rootSdfg, edgeStartUUID);
            const [endElem, endElemSdfg] =
                findJsonSDFGElementByUUID(rootSdfg, parentUUID);
            let element = undefined;
            if (startElemSdfg === endElemSdfg && startElem &&
                endElem && startElem.type === endElem.type) {
                if (startElem.type === SDFGElementType.SDFGState) {
                    element = {
                        type: 'Edge',
                        src: (startElem as any).id.toString(),
                        dst: (endElem as any).id.toString(),
                        attributes: {
                            data: {
                                type: 'InterstateEdge',
                                attributes: {},
                                label: '',
                            }
                        },
                    };
                    const iseMeta =
                        VSCodeSDFV.getInstance().getMetaDict()[
                            'InterstateEdge'
                        ];
                    for (const key in iseMeta) {
                        const attrs: any =
                            element.attributes.data.attributes;
                        if (attrs[key] === undefined) {
                            const val = iseMeta[key];
                            attrs[key] = val['default'];
                        }
                    }
                    addRoot = startElemSdfg;
                } else {
                    const parentIdParts = parentUUID.split('/');
                    const parentStateId =
                        parentIdParts[0] + '/' + parentIdParts[1];
                    const [parentState, _] = findJsonSDFGElementByUUID(
                        rootSdfg, parentStateId
                    );
                    if (parentState) {
                        element = {
                            type: 'MultiConnectorEdge',
                            src: (startElem as any).id.toString(),
                            dst: (endElem as any).id.toString(),
                            src_connector: null,
                            dst_connector: null,
                            attributes: {
                                data: {
                                    type: 'Memlet',
                                    attributes: {},
                                }
                            },
                        };
                        const mceMeta =
                            VSCodeSDFV.getInstance().getMetaDict()['Memlet'];
                        for (const key in mceMeta) {
                            const attrs: any =
                                element.attributes.data.attributes;
                            if (attrs[key] === undefined) {
                                const val = mceMeta[key];
                                attrs[key] = val['default'];
                            }
                        }
                        addRoot = parentState;
                    }
                }
            } else {
                element = undefined;
            }

            if (element && addRoot && addRoot.hasOwnProperty('edges')) {
                (addRoot as any).edges.push(element);
                this.add_position = null;
                this.add_edge_start = null;
                vscodeWriteGraph(rootSdfg);
            }
        } else {
            const [parentElem, parentSdfg] = findJsonSDFGElementByUUID(
                rootSdfg, parentUUID
            );

            let parent = parentElem as any;
            if (parentElem === undefined)
                parent = rootSdfg;

            if (parent && parent.hasOwnProperty('nodes')) {
                let maxId = -1;
                for (const el of parent.nodes)
                    maxId = Math.max(maxId, el.id);
                let element: any = {
                    id: maxId + 1,
                    type: addType,
                    attributes: {},
                };
                let exitElem: any = undefined;
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
                            const arrays = parentSdfg?.attributes?._arrays ?
                                Object.keys(parentSdfg.attributes._arrays) : [];
                            const data = arrays ? arrays[0].toString() : 'NULL';
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
                                type: SDFGElementType.SDFGState
                            };
                            const stateMeta =
                                VSCodeSDFV.getInstance().getMetaDict()[
                                    SDFGElementType.SDFGState
                                ];
                            for (const key in stateMeta) {
                                if (nSdfgState.attributes[key] === undefined) {
                                    const val = stateMeta[key];
                                    nSdfgState.attributes[key] = val['default'];
                                }
                            }
                            const nSdfg: JsonSDFG = {
                                attributes: {
                                    name: 'NewSDFG',
                                },
                                nodes: [nSdfgState],
                                edges: [],
                                start_state: 0,
                                type: 'SDFG',
                                error: undefined,
                                sdfg_list_id: maxSdfgId + 1,
                            };
                            const sdfgMeta =
                                VSCodeSDFV.getInstance().getMetaDict()['SDFG'];
                            for (const key in sdfgMeta) {
                                if (nSdfg.attributes[key] === undefined) {
                                    const val = sdfgMeta[key];
                                    nSdfg.attributes[key] = val['default'];
                                }
                            }
                            element.label = 'New Nested SDFG';
                            element.attributes.sdfg = nSdfg;
                        }
                        break;
                    case SDFGElementType.MapEntry:
                        {
                            element.label = 'New Map';
                            element.scope_entry = null;
                            element.scope_exit = element.id + 1;
                            exitElem = {
                                attributes: {},
                                id: element.id + 1,
                                label: element.label,
                                type: SDFGElementType.MapExit,
                                scope_entry: element.id,
                                scope_exit: element.id + 1,
                            };
                            const exitMeta =
                                VSCodeSDFV.getInstance().getMetaDict()[
                                    'MapExit'
                                ];
                            for (const key in exitMeta) {
                                if (exitElem.attributes[key] === undefined) {
                                    const val = exitMeta[key];
                                    exitElem.attributes[key] = val['default'];
                                }
                            }
                        }
                        break;
                    case SDFGElementType.ConsumeEntry:
                        {
                            element.label = 'New Consume';
                            element.scope_entry = null;
                            element.scope_exit = element.id + 1;
                            exitElem = {
                                attributes: {},
                                id: element.id + 1,
                                label: element.label,
                                type: SDFGElementType.ConsumeExit,
                                scope_entry: element.id,
                                scope_exit: element.id + 1,
                            };
                            const exitMeta =
                                VSCodeSDFV.getInstance().getMetaDict()[
                                    'ConsumeExit'
                                ];
                            for (const key in exitMeta) {
                                if (exitElem.attributes[key] === undefined) {
                                    const val = exitMeta[key];
                                    exitElem.attributes[key] = val['default'];
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

                if (element && parent?.nodes !== undefined) {
                    for (const key in meta) {
                        if (element.attributes[key] === undefined) {
                            const val = meta[key];
                            element.attributes[key] = val['default'];
                        }
                    }

                    if (addType.endsWith('Entry') && parent.scope_dict &&
                        exitElem) {
                        parent.scope_dict[element.id] = [exitElem.id];
                        const parentScope = parent.scope_dict['-1'];
                        if (parentScope)
                            parentScope.push(element.id);
                        else
                            parent.scope_dict['-1'] = [element.id];
                    } else if (addType !== SDFGElementType.SDFGState &&
                        parent.scope_dict) {
                        element.scope_entry = null;
                        element.scope_exit = null;
                        const parentScope = parent.scope_dict['-1'];
                        if (parentScope)
                            parentScope.push(element.id);
                        else
                            parent.scope_dict['-1'] = [element.id];
                    }

                    parent.nodes.push(element);
                    if (exitElem)
                        parent.nodes.push(exitElem);

                    set_positioning_info(element, this.add_position);
                    this.add_position = null;

                    vscodeWriteGraph(rootSdfg);
                }
            }
        }
    }

    public removeGraphNodes(nodes: SDFGElement[]): void {
        let g = this.sdfg;
        unGraphiphySdfg(g);

        const uuids = [];
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const uuid = get_uuid_graph_element(node);
            uuids.push(uuid);

            // If we're deleting a scope node, we want to remove the
            // corresponding entry/exit node as well.
            let otherUUID = undefined;
            if (node instanceof EntryNode)
                otherUUID = node.sdfg.sdfg_list_id + '/' +
                    node.parent_id + '/' +
                    node.data.node.scope_exit + '/-1';
            else if (node instanceof ExitNode)
                otherUUID = node.sdfg.sdfg_list_id + '/' +
                    node.parent_id + '/' +
                    node.data.node.scope_entry + '/-1';

            if (otherUUID)
                uuids.push(otherUUID);
        }

        vscode.postMessage({
            type: 'dace.remove_nodes',
            sdfg: JSON.stringify(g),
            uuids: uuids,
        });
    }

    /**
     * Set the correct poisiton for newly added graph elements.
     * This is called as a callback after a new element has been added to the
     * graph and uses a previously stored adding poistion to correctly
     * position the newly added element.
     */
    public updateNewElement(uuids: string[]): void {
        if (!this.add_position || !this.graph)
            return;

        let first = uuids[0];

        if (first === 'NONE')
            return;

        let el = find_graph_element_by_uuid(this.graph, first).element;

        // TODO: set in construction attribute
        this.canvas_manager?.translate_element(
            el, { x: el.x, y: el.y }, this.add_position, this.graph,
            this.sdfg_list, this.state_parent_list, null, true
        );

        if (el instanceof EntryNode && uuids.length >= 2) {
            let exit = find_graph_element_by_uuid(this.graph, uuids[1]).element;
            if (exit) {
                this.canvas_manager?.translate_element(
                    exit, { x: exit.x, y: exit.y },
                    { x: this.add_position.x, y: this.add_position.y + 100},
                    this.graph, this.sdfg_list, this.state_parent_list, null,
                    true
                );
            }
        }

        this.add_position = null;

        this.sendNewSdfgToVscode();
    }

    public showNoDaemonDialog(): void {
        const modalRet = createSingleUseModal(
            'No DaCe Daemon', false, ''
        );
        modalRet.body.append($('<p>', {
            'text': 'You need to open the SDFG Optimization sidepanel to ' +
                'add SDFG elements or edit SDFG properties',
        }));
        modalRet.modal.modal('show');
    }

    public showSelectLibraryNodeDialog(callback: CallableFunction): void {
        const sdfgMetaDict = VSCodeSDFV.getInstance().getMetaDict();

        const modalRet = createSingleUseModal(
            'Select Library Node', true, ''
        );

        const libraries = sdfgMetaDict['__libs__'];

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
            'text': 'Library:'
        }).appendTo(headerWrapper);

        const libInputWrapper = $('<div>', {
            'class': 'col-9',
        }).appendTo(row);
        const libInput = $('<select>', {
            'id': 'lib-selection-input-list',
            'class': 'sdfv-property-dropdown',
            'style': 'width: 100%;',
            'placeholder': 'Type to search...'
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
                this.add_mode_lib = libraries[libInputVal];
                modalRet.modal.modal('hide');
            } else {
                backgroundLibInput.addClass('is-invalid');
            }
        });

        modalRet.modal.modal('show');
    }

    public clearSelectedItems(): void {
        this.selected_elements = [];
    }

    public setDaemonConnected(connected: boolean): void {
        this.dace_daemon_connected = connected;
    }

}
