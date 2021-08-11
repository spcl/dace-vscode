// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    AccessNode,
    Connector,
    DagreSDFG,
    Edge,
    EntryNode,
    ExitNode,
    find_graph_element_by_uuid,
    find_in_graph,
    GenericSdfgOverlay,
    get_uuid_graph_element,
    JsonSDFG,
    LibraryNode,
    MemoryVolumeOverlay,
    mouse_event,
    parse_sdfg,
    RuntimeMicroSecondsOverlay,
    ScopeNode,
    SDFG,
    SDFGElement,
    SDFGNode,
    SDFGRenderer,
    sdfg_property_to_string,
    sdfg_range_elem_to_string,
    SDFV,
    State,
    StaticFlopsOverlay,
    traverse_sdfg_scopes,
} from '@spcl/sdfv/out';
import { Range } from '../../../types';
import { JsonTransformation } from '../transformations/transformations';
import { refreshAnalysisPane } from './analysis/analysis';
import { BreakpointIndicator, refreshBreakpoints } from './breakpoints/breakpoints';
import {
    CodeProperty,
    ComboboxProperty,
    DictProperty,
    KeyProperty,
    ListProperty,
    Property,
    PropertyEntry,
    RangeProperty,
    TypeclassProperty,
    ValueProperty
} from './properties/properties';
import { VSCodeRenderer } from './renderer/vscode_renderer';
import {
    getApplicableTransformations,
    refreshTransformationList,
    sortTransformations,
} from './transformation/transformation';

type CategorizedTransformationList = [
    JsonTransformation[],
    JsonTransformation[],
    JsonTransformation[],
    JsonTransformation[],
];

export class VSCodeSDFV {

    public static readonly DEBUG_DRAW: boolean = false;

    private static readonly INSTANCE: VSCodeSDFV = new VSCodeSDFV();

    private constructor() {
        const sdfv = SDFV.get_instance();
        sdfv.register_init_menu_handler(this.initInfoBox);
        sdfv.register_close_menu_handler(this.clearInfoBox);
        sdfv.register_sidebar_get_contents_handler(this.infoBoxGetContents);
        sdfv.register_sidebar_show_handler(this.infoBoxShow);
        sdfv.register_sidebar_set_title_handler(this.infoBoxSetTitle);
        sdfv.register_outline_handler(this.outline);
        sdfv.register_fill_info_handler(this.fillInfo);
        sdfv.register_start_find_in_graph_handler(this.startFindInGraph);
    }

    public static getInstance(): VSCodeSDFV {
        return this.INSTANCE;
    }

    public static readonly OVERLAYS: {
        [key: string]: typeof GenericSdfgOverlay,
    } = {
        'MEMORY_VOLUME_OVERLAY': MemoryVolumeOverlay,
        'STATIC_FLOPS_OVERLAY': StaticFlopsOverlay,
        'RUNTIME_MICRO_SECONDS_OVERLAY': RuntimeMicroSecondsOverlay,
        'BREAKPOINT_INDICATOR': BreakpointIndicator,
    };

    private monaco: any | null = null;
    private sdfgString: string | null = null;
    private sdfgMetaDict: { [key: string]: any } | null = null;
    private viewingHistoryState: boolean = false;
    private showingBreakpoints: boolean = false;
    private daemonConnected: boolean = false;
    private transformations: CategorizedTransformationList = [[], [], [], []];
    private selectedTransformation: JsonTransformation | null = null;

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
    public infoBoxShow(): void {
        $('#info-clear-btn').show();
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
    public clearInfoBox(): void {
        $('#info-contents').html('');
        $('#info-title').text('');
        $('#info-clear-btn').hide();
        $('#goto-source-btn').hide();
        $('#goto-cpp-btn').hide();
        this.selectedTransformation = null;
        if (vscode)
            vscode.postMessage({
                'type': 'transformation_list.deselect',
            });
    }

    public outline(renderer: SDFGRenderer, graph: DagreSDFG): void {
        if (vscode === undefined)
            return;

        const outline_list = [];

        const top_level_sdfg = {
            'icon': 'res:icon-theme/sdfg.svg',
            'type': 'SDFG',
            'label': `SDFG ${renderer.get_sdfg().attributes.name}`,
            'collapsed': false,
            'uuid': get_uuid_graph_element(null),
            'children': [],
        };
        outline_list.push(top_level_sdfg);

        const stack: any[] = [top_level_sdfg];

        traverse_sdfg_scopes(graph, (node: SDFGNode, _parent: SDFGElement): boolean => {
            // Skip exit nodes when scopes are known.
            if (node.type().endsWith('Exit') && node.data.node.scope_entry >= 0) {
                stack.push(undefined);
                return true;
            }

            // Create an entry.
            let is_collapsed = node.attributes().is_collapsed;
            is_collapsed = (is_collapsed === undefined) ? false : is_collapsed;
            let node_label = node.label();
            if (node.type() === 'NestedSDFG')
                node_label = node.data.node.label;

            // If a scope has children, remove the name "Entry" from the type.
            let node_type = node.type();
            if (node_type.endsWith('Entry')) {
                const state = node.parent_id !== null ?
                    node.sdfg.nodes[node.parent_id] : null;
                if (state && state.scope_dict[node.id] !== undefined)
                    node_type = node_type.slice(0, -5);
            }

            let icon;
            switch (node_type) {
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
                    icon = 'res:icon-theme/sdfg.svg';
                    break;
                default:
                    icon = '';
                    break;
            }

            stack.push({
                'icon': icon,
                'type': node_type,
                'label': node_label,
                'collapsed': is_collapsed,
                'uuid': get_uuid_graph_element(node),
                'children': [],
            });

            // If the node's collapsed we don't traverse any further.
            if (is_collapsed)
                return false;
            return true;
        }, (_node: SDFGNode, _parent: SDFGElement) => {
            // After scope ends, pop ourselves as the current element and add
            // outselves to the parent.
            const elem = stack.pop();
            const elem_parent = stack[stack.length - 1];
            if (elem !== undefined && elem_parent !== undefined)
                elem_parent['children'].push(elem);
        });

        vscode.postMessage({
            type: 'outline.set_outline',
            outline_list: outline_list,
        });
    }

    /**
     * Fill out the info-box of the embedded layout with info about an element.
     * This dynamically builds one or more tables showing all of the relevant info
     * about a given element.
     */
    public fillInfo(elem: SDFGElement): void {
        const buttons = [
            $('#goto-source-btn'),
            $('#goto-cpp-btn')
        ];

        // Clear and hide these buttons.
        buttons.forEach((btn) =>{
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

            generateAttributesTable(elem, undefined, contents);

            if (elem instanceof AccessNode) {
                // If we're processing an access node, add array information too.
                const sdfg_array = elem.sdfg.attributes._arrays[
                    elem.attributes().data
                ];
                $('<br>').appendTo(contents);
                $('<p>', {
                    'class': 'info-subtitle',
                    'text': sdfg_array.type + ' properties:',
                }).appendTo(contents);

                generateAttributesTable(sdfg_array, undefined, contents);
            } else if (elem instanceof ScopeNode) {
                // If we're processing a scope node, we want to append the exit
                // node's properties when selecting an entry node, and vice versa.
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

                    generateAttributesTable(other_element, undefined, contents);
                }
            }

            $('#info-clear-btn').show();
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
                    typeof searchVal === 'string')
                    find_in_graph(
                        renderer, graph, searchVal,
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
        let renderer = VSCodeRenderer.getInstance();

        if (renderer) {
            renderer.set_sdfg(parsedSdfg);
        } else {
            const contentsElem = document.getElementById('contents');
            if (contentsElem === null) {
                console.error('Could not find element to attach renderer to');
                return;
            }

            if (parsedSdfg !== null)
                renderer = VSCodeRenderer.init(
                    parsedSdfg, contentsElem,
                    mouse_event, null, VSCodeSDFV.DEBUG_DRAW, null, null
                );
            else
                return;
        }

        if (!previewing) {
            this.sdfgString = sdfgString;
            if (!preventRefreshes)
                getApplicableTransformations();
        }

        const graph = renderer.get_graph();
        if (graph)
            this.outline(renderer, graph);
        refreshAnalysisPane();
        refreshBreakpoints();

        const selectedElements = renderer.get_selected_elements();
        if (selectedElements && selectedElements.length === 1)
            reselectRendererElement(selectedElements[0]);
        else if (!selectedElements || selectedElements.length === 0)
            this.fillInfo(
                new SDFG(renderer.get_sdfg())
            );

        vscode.postMessage({
            type: "sdfv.process_queued_messages",
            sdfgName: renderer.get_sdfg().attributes.name,
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
                parsedSdfg, contentsElem, mouse_event, userTransform,
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

    public getMonaco(): any | null {
        return this.monaco;
    }

    public getSdfgString(): string | null {
        return this.sdfgString;
    }

    public getMetaDict(): { [key: string]: any } | null {
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

    public getTransformations(): CategorizedTransformationList {
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
    }

    public setTransformations(
        transformations: CategorizedTransformationList
    ): void {
        this.transformations = transformations;
    }

    public setSelectedTransformation(
        selectedTransformation: JsonTransformation | null
    ): void {
        this.selectedTransformation = selectedTransformation;
    }

}

export function vscodeHandleEvent(event: string, data: any) {
    switch (event) {
        case 'on_renderer_selection_changed':
            if (data && data.multi_selection_changed)
                getApplicableTransformations();
            else
                sortTransformations(refreshTransformationList);
            break;
    }
}

export function createSingleUseModal(
    title: string, withConfirm: boolean, bodyClass: string
): { modal: any, body: JQuery, confirmBtn: JQuery | undefined } {
    const propEditModal = $('<div>', {
        'class': 'modal fade',
        'role': 'dialog',
    }).appendTo('body');

    const modalDoc = $('<div>', {
        'class': 'modal-dialog modal-dialog-centered',
        'role': 'document',
    }).appendTo(propEditModal);
    const modalContent = $('<div>', {
        'class': 'modal-content',
    }).appendTo(modalDoc);
    const modalHeader = $('<div>', {
        'class': 'modal-header',
    }).appendTo(modalContent);

    $('<h5>', {
        'class': 'modal-title',
        'text': title,
    }).appendTo(modalHeader);

    const modalBody = $('<div>', {
        'class': 'modal-body' + (' ' + bodyClass),
    }).appendTo(modalContent);

    const modalFooter = $('<div>', {
        'class': 'modal-footer',
    }).appendTo(modalContent);
    $('<button>', {
        'class': 'btn btn-secondary',
        'type': 'button',
        'data-bs-dismiss': 'modal',
        'text': 'Close',
    }).appendTo(modalFooter);

    let modalConfirmBtn = undefined;
    if (withConfirm)
        modalConfirmBtn = $('<button>', {
            'class': 'btn btn-primary',
            'type': 'button',
            'text': 'Ok',
        }).appendTo(modalFooter);

    propEditModal.on('hidden.bs.modal', () => propEditModal.remove());

    return {
        modal: propEditModal,
        body: modalBody,
        confirmBtn: modalConfirmBtn,
    };
}

export function computeScopeLabel(scopeEntry: EntryNode): string {
    const attributes = scopeEntry.data.node.attributes;
    const baseLabel = attributes.label;

    let rangeSnippets = [];
    for (let i = 0; i < attributes.range.ranges.length; i++) {
        let parameter = '_';
        if (i < attributes.params.length)
            parameter = attributes.params[i];

        let range = attributes.range.ranges[i];
        rangeSnippets.push(
            parameter + '=' + sdfg_range_elem_to_string(
                range, VSCodeRenderer.getInstance()?.view_settings()
            )
        );
    }

    if (rangeSnippets.length > 0) {
        let label = baseLabel + '[';
        for (let i = 0; i < rangeSnippets.length; i++) {
            label += rangeSnippets[i];
            if (i < rangeSnippets.length - 1)
                label += ', ';
        }
        label += ']';
        return label;
    } else {
        return baseLabel;
    }
}

export function elementUpdateLabel(element: SDFGElement, attributes: any): void {
    if (element.data) {
        if (element.data.node) {
            if (attributes.label)
                element.data.node.label = attributes.label;

            if (element instanceof ScopeNode) {
                // In scope nodes the range is attached.
                if (element instanceof EntryNode) {
                    let exitElem = find_graph_element_by_uuid(
                        VSCodeRenderer.getInstance()?.get_graph(),
                        element.sdfg.sdfg_list_id + '/' +
                        element.parent_id + '/' +
                        element.data.node.scope_exit + '/-1'
                    );
                    if (exitElem) {
                        element.data.node.label = computeScopeLabel(element);
                        exitElem.element.data.node.label =
                            element.data.node.label;
                    }
                } else if (element instanceof ExitNode) {
                    let entryElem = find_graph_element_by_uuid(
                        VSCodeRenderer.getInstance()?.get_graph(),
                        element.sdfg.sdfg_list_id + '/' +
                        element.parent_id + '/' +
                        element.data.node.scope_entry + '/-1'
                    );
                    if (entryElem) {
                        element.data.node.label =
                            computeScopeLabel(entryElem.element);
                        entryElem.element.data.node.label =
                            element.data.node.label;
                    }
                }
            } else if (element instanceof AccessNode && attributes.data) {
                element.data.node.label = attributes.data;
            }
        }
    }
}

/**
 * Transform the renderer's graph to a serializable SDFG.
 * The renderer uses a graph representation with additional information, and to
 * make sure that the classical SDFG representation and that graph
 * representation are kept in sync, the SDFG object is made cyclical. This
 * function breaks the renderer's SDFG representation back down into the
 * classical one, removing layout information along with it.
 * NOTE: This operates in-place on the renderer's graph representation.
 */
export function unGraphiphySdfg(g: JsonSDFG): void {
    g.edges.forEach((e: any) => {
        if (e.attributes.data.edge)
            delete e.attributes.data.edge;
    });

    g.nodes.forEach((s: any) => {
        if (s.attributes.layout)
            delete s.attributes.layout;

        s.edges.forEach((e: any) => {
            if (e.attributes.data.edge)
                delete e.attributes.data.edge;
        });

        s.nodes.forEach((v: any) => {
            if (v.attributes.layout)
                delete v.attributes.layout;

            if (v.type === 'NestedSDFG')
                unGraphiphySdfg(v.attributes.sdfg);
        });
    });
}

export function vscodeWriteGraph(g: JsonSDFG): void {
    unGraphiphySdfg(g);
    if (vscode)
        vscode.postMessage({
            type: 'dace.write_edit_to_sdfg',
            sdfg: JSON.stringify(g),
        });
}

export function reselectRendererElement(elem: SDFGElement): void {
    const graph = VSCodeRenderer.getInstance()?.get_graph();
    if (graph) {
        const uuid = get_uuid_graph_element(elem);
        const newElemRes = find_graph_element_by_uuid(graph, uuid);
        if (newElemRes && newElemRes.element) {
            const newElem = newElemRes.element;
            SDFV.get_instance().fill_info(newElem);
        }
    }
}

export function getTransformationMetadata(transformation: any): any {
    let metadata = undefined;
    const sdfgMetaDict = VSCodeSDFV.getInstance().getMetaDict();
    if (sdfgMetaDict) {
        if (transformation.transformation)
            metadata = sdfgMetaDict[transformation.transformation];
    } else {
        // If SDFG property metadata isn't available, query it from DaCe.
        vscode.postMessage({
            type: 'dace.query_sdfg_metadata',
        });
    }
    return metadata;
}

export function getElementMetadata(elem: any): any {
    let metadata: any = undefined;
    const sdfgMetaDict = VSCodeSDFV.getInstance().getMetaDict();
    if (sdfgMetaDict) {
        if (elem instanceof SDFGElement) {
            if (elem.data.sdfg) {
                metadata = sdfgMetaDict[elem.data.sdfg.type];
            } else if (elem.data.state) {
                metadata = sdfgMetaDict[elem.data.state.type];
            } else if (elem.data.node) {
                const nodeType = elem.data.node.type;
                if (elem instanceof ScopeNode) {
                    let nodeMeta = sdfgMetaDict[nodeType];
                    let scopeMeta: any = undefined;
                    let entryIdx = nodeType.indexOf('Entry');
                    let exitIdx = nodeType.indexOf('Exit');
                    if (entryIdx)
                        scopeMeta =
                            sdfgMetaDict[nodeType.substring(0, entryIdx)];
                    else if (exitIdx)
                        scopeMeta =
                            sdfgMetaDict[nodeType.substring(0, exitIdx)];

                    metadata = {};
                    if (nodeMeta !== undefined)
                        Object.keys(nodeMeta).forEach(k => {
                            metadata[k] = nodeMeta[k];
                        });
                    if (scopeMeta !== undefined)
                        Object.keys(scopeMeta).forEach(k => {
                            metadata[k] = scopeMeta[k];
                        });
                } else if (nodeType === 'LibraryNode') {
                    metadata = sdfgMetaDict[elem.data.node.classpath];
                } else {
                    metadata = sdfgMetaDict[nodeType];
                }
            } else if (elem.data.type) {
                metadata = sdfgMetaDict[elem.data.type];
            }
        } else if (elem.type) {
            metadata = sdfgMetaDict[elem.type];
        }
    } else {
        // If SDFG property metadata isn't available, query it from DaCe.
        vscode.postMessage({
            type: 'dace.query_sdfg_metadata',
        });
    }
    return metadata;
}

export function attrTablePutBool(
    key: string, subkey: string | undefined, val: boolean,
    elem: any | undefined, xform: any | undefined, target: any,
    cell: JQuery, dtype: string
): ValueProperty {
    const boolInputContainer = $('<div>', {
        'class': 'form-check form-switch sdfv-property-bool',
    }).appendTo(cell);
    const input = $('<input>', {
        'type': 'checkbox',
        'id': 'switch_' + key,
        'class': 'form-check-input',
        'checked': val,
    }).appendTo(boolInputContainer);
    boolInputContainer.append($('<label>', {
        'class': 'form-check-label',
        'text': ' ',
        'for': 'switch_' + key,
    }));
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutText(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string
): ValueProperty {
    const input = $('<input>', {
        'type': 'text',
        'class': 'sdfv-property-text',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutCode(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string
): CodeProperty {
    const sdfgMetaDict = VSCodeSDFV.getInstance().getMetaDict();

    let lang = 'Python';
    if (target[key])
        lang = target[key]['language'];

    const container = $('<div>', {
        'class': 'sdfv-property-code-container',
    }).appendTo(cell);

    const input = $('<div>', {
        'class': 'sdfv-property-monaco',
    }).appendTo(container);

    const languages: string[] = sdfgMetaDict ? sdfgMetaDict[
        '__reverse_type_lookup__'
    ]['Language'].choices : [];
    const languageInput = $('<select>', {
        'class': 'sdfv-property-dropdown',
    }).appendTo(container);
    languages.forEach(l => {
        languageInput.append(new Option(
            l,
            l,
            false,
            l === lang
        ));
    });

    const editor = VSCodeSDFV.getInstance().getMonaco().editor.create(
        input.get(0), {
            'value': val,
            'language': lang === undefined ? 'python' : lang.toLowerCase(),
            'theme': getMonacoThemeName(),
            'glyphMargin': 0,
            'lineDecorationsWidth': 0,
            'lineNumbers': 'off',
            'lineNumbersMinChars': 0,
            'minimap': {
                'enabled': false,
            },
            'padding': {
                'top': 0,
                'bottom': 0,
            },
        }
    );

    return new CodeProperty(
        elem, xform, target, key, subkey, dtype, input, languageInput, editor
    );
}

export function attrTablePutNumber(
    key: string, subkey: string | undefined, val: number, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string
): ValueProperty {
    const input = $('<input>', {
        'type': 'number',
        'class': 'sdfv-property-number',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutSelect(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    choices: string[]
): ValueProperty {
    const input = $('<select>', {
        'class': 'sdfv-property-dropdown',
    }).appendTo(cell);
    if (!choices.includes(val))
        input.append(new Option(
            val,
            val,
            false,
            true
        ));
    choices.forEach(array => {
        input.append(new Option(
            array,
            array,
            false,
            array === val
        ));
    });

    if (elem && elem instanceof LibraryNode && key === 'implementation')
        $('<button>', {
            'class': 'btn btn-sm btn-primary sdfv-property-expand-libnode-btn',
            'text': 'Expand',
            'click': () => {
                if (vscode)
                    vscode.postMessage({
                        type: 'dace.expand_library_node',
                        nodeid: [
                            elem.sdfg.sdfg_list_id,
                            elem.parent_id,
                            elem.id,
                        ],
                    });
            },
        }).appendTo(cell);

    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutTypeclass(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    choices: string[]
): TypeclassProperty {
    const input = $('<select>', {
        'id': key + '-typeclass-dropdown',
        'class': 'sdfv-property-dropdown',
    }).appendTo(cell);
    let found = false;
    if (choices) {
        choices.forEach(array => {
            input.append(new Option(
                array,
                array,
                array === val,
                array === val
            ));

            if (array === val)
                found = true;
        });
    }

    if (!found)
        input.append(new Option(val, val, true, true));

    input.editableSelect({
        filter: false,
        effects: 'fade',
        duration: 'fast',
    });

    return new TypeclassProperty(
        elem, xform, target, key, subkey, dtype, input,
        $('#' + key + '-typeclass-dropdown')
    );
}

export function attrTablePutDict(
    key: string, subkey: string | undefined, val: any, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    valMeta: any
): DictProperty {
    const dictCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfg_property_to_string(
            val, VSCodeRenderer.getInstance()?.view_settings()
        ),
    }).appendTo(dictCellContainer);
    const dictEditBtn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(dictCellContainer);

    const prop = new DictProperty(elem, xform, target, key, subkey, dtype, []);

    dictEditBtn.on('click', () => {
        prop.setProperties([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        Object.keys(val).forEach(k => {
            let v = val[k];
            const attrProp = attributeTablePutEntry(
                k, v, valMeta, val, elem, xform, rowbox, true, false, true
            );

            if (attrProp.deleteBtn)
                attrProp.deleteBtn.on('click', () => {
                    attrProp.keyProp?.getInput().val('');
                    attrProp.row.hide();
                });

            if (attrProp)
                prop.getProperties().push(attrProp);
        });

        // If code editors (monaco editors) are part of this dictionary, they
        // need to be resized again as soon as the modal is shown in order to
        // properly fill the container.
        modal.modal.on('shown.bs.modal', () => {
            for (const property of prop.getProperties()) {
                if (property.valProp instanceof CodeProperty)
                    property.valProp.getEditor().layout();
            }
        });

        const addItemContainer = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(addItemContainer);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                let newProp: PropertyEntry;
                if (valMeta)
                    newProp = attributeTablePutEntry(
                        '', '', valMeta, val, elem, xform, rowbox, true, false,
                        true
                    );
                else
                    newProp = attributeTablePutEntry(
                        '', '', { metatype: 'str' }, val, elem, xform, rowbox,
                        true, false, true
                    );
                if (newProp) {
                    prop.getProperties().push(newProp);

                    if (newProp.deleteBtn)
                        newProp.deleteBtn.on('click', () => {
                            newProp.keyProp?.getInput().val('');
                            newProp.row.hide();
                        });
                }
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(addItemButtonRow));

        if (modal.confirmBtn)
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                if (prop.update() && !xform && sdfg)
                    vscodeWriteGraph(sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

export function attrTablePutList(
    key: string, subkey: string | undefined, val: any[],
    elem: any | undefined, xform: any | undefined, target: any, cell: JQuery,
    dtype: string, elemMeta: any
): ListProperty {
    // If a list's element type is unknown, i.e. there is no element metadata,
    // treat it as a string so it can be edited properly.
    if (elemMeta === undefined)
        elemMeta = {
            metatype: 'str',
        };

    const listCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfg_property_to_string(
            val, VSCodeRenderer.getInstance()?.view_settings()
        ),
    }).appendTo(listCellContainer);
    const listCellEditBtn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(listCellContainer);

    const prop = new ListProperty(elem, xform, target, key, subkey, dtype, []);

    listCellEditBtn.on('click', () => {
        prop.setPropertiesList([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        if (val) {
            for (let i = 0; i < val.length; i++) {
                const v = val[i];
                const attrProp = attributeTablePutEntry(
                    i.toString(), v, elemMeta, val, elem, xform, rowbox, false,
                    false, true
                );

                if (attrProp.deleteBtn) {
                    attrProp.deleteBtn.on('click', () => {
                        if (attrProp.valProp &&
                            attrProp.valProp instanceof ValueProperty &&
                            attrProp.valProp.getInput()) {
                            attrProp.valProp.getInput().val('');
                            attrProp.row.hide();
                        }
                    });
                }

                if (attrProp && attrProp.valProp)
                    prop.getPropertiesList().push(attrProp.valProp);
            }

            // If code editors (monaco editors) are part of this list, they
            // need to be resized again as soon as the modal is shown in order
            // to properly fill the container.
            modal.modal.on('shown.bs.modal', () => {
                for (const property of prop.getPropertiesList()) {
                    if (property instanceof CodeProperty)
                        property.getEditor().layout();
                }
            });
        }

        const addItemContainer = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const AddItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(addItemContainer);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                let i = prop.getPropertiesList().length;
                let newProp = attributeTablePutEntry(
                    i.toString(), '', elemMeta, val, elem, xform, rowbox, false,
                    false, true
                );
                if (newProp && newProp.valProp) {
                    prop.getPropertiesList().push(newProp.valProp);

                    if (newProp.deleteBtn) {
                        newProp.deleteBtn.on('click', () => {
                            if (newProp.valProp &&
                                newProp.valProp instanceof ValueProperty &&
                                newProp.valProp.getInput()) {
                                newProp.valProp.getInput().val('');
                                newProp.row.hide();
                            }
                        });
                    }
                }
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(AddItemButtonRow));

        if (modal.confirmBtn)
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                if (prop.update() && !xform && sdfg)
                    vscodeWriteGraph(sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

export function attrTablePutRange(
    key: string, subkey: string | undefined, val: any, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string
): RangeProperty {
    const rangeCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<td>', {
        'html': sdfg_property_to_string(
            val, VSCodeRenderer.getInstance()?.view_settings()
        ),
    }).appendTo(rangeCellContainer);
    const rangeEditBtn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(rangeCellContainer);

    const prop = new RangeProperty(
        elem, xform, target, key, 'ranges', dtype, []
    );

    rangeEditBtn.on('click', () => {
        prop.setRangeInputList([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        if (val && val.ranges)
            val.ranges.forEach((range: Range) => {
                const valRow = $('<div>', {
                    'class': 'row',
                }).appendTo(rowbox);

                const rangeStartInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': range.start,
                });
                const rangeStartContainer = $('<div>', {
                    'class': 'col-3 sdfv-property-range-delete-cell',
                }).appendTo(valRow);
                const deleteBtn = $('<span>', {
                    'class': 'material-icons-outlined sdfv-property-delete-btn',
                    'text': 'remove_circle',
                    'title': 'Delete entry',
                }).appendTo(rangeStartContainer);
                rangeStartContainer.append($('<div>').append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Start:',
                })).append(rangeStartInput));

                const rangeEndInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': range.end,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'End:',
                })).append(rangeEndInput);

                const rangeStepInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': range.step,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Step:',
                })).append(rangeStepInput);

                const rangeTileInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': range.tile,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Tile:',
                })).append(rangeTileInput);

                deleteBtn.on('click', () => {
                    rangeStartInput.val('');
                    rangeEndInput.val('');
                    rangeStepInput.val('');
                    rangeTileInput.val('');
                    valRow.hide();
                });

                prop.getRangeInputList().push({
                    start: rangeStartInput,
                    end: rangeEndInput,
                    step: rangeStepInput,
                    tile: rangeTileInput,
                });
            });

        const addItemContainer = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(addItemContainer);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                const valRow = $('<div>', {
                    'class': 'row',
                }).appendTo(rowbox);

                const rangeStartInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': '',
                });
                const rangeStartContainer = $('<div>', {
                    'class': 'col-3 sdfv-property-range-delete-cell',
                }).appendTo(valRow);
                const deleteBtn = $('<span>', {
                    'class': 'material-icons-outlined sdfv-property-delete-btn',
                    'text': 'remove_circle',
                    'title': 'Delete entry',
                }).appendTo(rangeStartContainer);
                rangeStartContainer.append($('<div>').append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Start:',
                })).append(rangeStartInput));

                const rangeEndInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'End:',
                })).append(rangeEndInput);

                const rangeStepInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Step:',
                })).append(rangeStepInput);

                const rangeTileInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Tile:',
                })).append(rangeTileInput);

                deleteBtn.on('click', () => {
                    rangeStartInput.val('');
                    rangeEndInput.val('');
                    rangeStepInput.val('');
                    rangeTileInput.val('');
                    valRow.hide();
                });

                prop.getRangeInputList().push({
                    start: rangeStartInput,
                    end: rangeEndInput,
                    step: rangeStepInput,
                    tile: rangeTileInput,
                });
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(addItemButtonRow));

        if (modal.confirmBtn)
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                if (prop.update() && !xform && sdfg)
                    vscodeWriteGraph(sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

export function attributeTablePutEntry(
    key: string, val: any, meta: any, target: any, elem: any | undefined,
    xform: any | undefined, root: JQuery, editableKey: boolean,
    updateOnChange: boolean, addDeleteButton: boolean
): PropertyEntry {
    let keyProp: KeyProperty | undefined = undefined;
    let valProp: Property | undefined = undefined;
    let deleteBtn = undefined;

    let dtype = undefined;
    let choices = undefined;
    if (meta) {
        if (meta['metatype'])
            dtype = meta['metatype'];
        if (meta['choices'])
            choices = meta['choices'];
    }

    const row = $('<div>', {
        'class': 'row attr-table-row',
    }).appendTo(root);
    let keyCell = undefined;
    if (editableKey) {
        keyCell = $('<div>', {
            'class': 'col-3 attr-table-cell',
        }).appendTo(row);
        const keyInput = $('<input>', {
            'type': 'text',
            'class': 'property-key-input sdfv-property-text',
            'value': key,
        }).appendTo(keyCell);

        keyProp = new KeyProperty(elem, xform, target, key, keyInput);
    } else {
        keyCell = $('<div>', {
            'class': 'col-3 attr-table-heading attr-table-cell',
            'text': key,
        }).appendTo(row);
    }

    if (meta && meta['desc'])
        row.attr('title', meta['desc']);

    if (addDeleteButton) {
        keyCell.addClass('attr-table-cell-nopad');
        deleteBtn = $('<span>', {
            'class': 'material-icons-outlined sdfv-property-delete-btn',
            'text': 'remove_circle',
            'title': 'Delete entry',
        }).prependTo(keyCell);
    }

    const valueCell = $('<div>', {
        'class': 'col-9 attr-table-cell',
    }).appendTo(row);

    if (dtype === undefined) {
        // Implementations that are set to null should still be visible. Other
        // null properties should be shown as an empty field.
        if (key === 'implementation' && val === null)
            valueCell.html('null');
        else
            valueCell.html(sdfg_property_to_string(
                val, VSCodeRenderer.getInstance()?.view_settings()
            ));
    } else {
        const sdfgMetaDict = VSCodeSDFV.getInstance().getMetaDict();
        switch (dtype) {
            case 'typeclass':
                valProp = attrTablePutTypeclass(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    choices
                );
                break;
            case 'bool':
                valProp = attrTablePutBool(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            case 'str':
            case 'LambdaProperty':
            case 'SymbolicProperty':
                // TODO(later): Treat symbolic expressions with a symbolic
                // parser, they're not just a regular string.
                valProp = attrTablePutText(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            case 'int':
                valProp = attrTablePutNumber(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            case 'dict':
                let valType = undefined;
                let valMeta = undefined;
                if (meta !== undefined && meta['value_type'])
                    valType = meta['value_type'];
                if (sdfgMetaDict && valType &&
                    sdfgMetaDict['__reverse_type_lookup__'] &&
                    sdfgMetaDict['__reverse_type_lookup__'][valType])
                    valMeta = sdfgMetaDict['__reverse_type_lookup__'][valType];
                attrTablePutDict(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    valMeta
                );
                break;
            case 'set':
            case 'list':
            case 'tuple':
                let elemType = undefined;
                let elemMety = undefined;
                if (meta !== undefined && meta['element_type'])
                    elemType = meta['element_type'];
                if (sdfgMetaDict && elemType &&
                    sdfgMetaDict['__reverse_type_lookup__'] &&
                    sdfgMetaDict['__reverse_type_lookup__'][elemType])
                    elemMety =
                        sdfgMetaDict['__reverse_type_lookup__'][elemType];
                valProp = attrTablePutList(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    elemMety
                );
                break;
            case 'Range':
            case 'SubsetProperty':
                valProp = attrTablePutRange(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            case 'DataProperty':
                valProp = attrTablePutSelect(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    elem ? Object.keys(elem.sdfg.attributes._arrays): []
                );
                break;
            case 'CodeBlock':
                valProp = attrTablePutCode(
                    key, undefined, val ? val.string_data : '', elem, xform,
                    target, valueCell, dtype
                );
                break;
            default:
                if (choices !== undefined)
                    valProp = attrTablePutSelect(
                        key, undefined, val, elem, xform, target, valueCell,
                        dtype, choices
                    );
                else
                    valueCell.html(sdfg_property_to_string(
                        val, VSCodeRenderer.getInstance()?.view_settings()
                    ));
                break;
        }
    }

    if (updateOnChange && valProp !== undefined) {
        if (valProp instanceof ValueProperty) {
            if (valProp instanceof ComboboxProperty) {
                valProp.getInput().on('hidden.editable-select', () => {
                    if (valProp) {
                        const valueChanged = valProp.update();
                        const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                        if (!xform && valueChanged && sdfg)
                            vscodeWriteGraph(sdfg);
                    }
                });
                valProp.getInput().on('select.editable-select', () => {
                    if (valProp) {
                        const valueChanged = valProp.update();
                        const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                        if (!xform && valueChanged && sdfg)
                            vscodeWriteGraph(sdfg);
                    }
                });
            } else {
                valProp.getInput().on('change', () => {
                    if (valProp) {
                        valProp.update();
                        const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                        if (!xform && sdfg)
                            vscodeWriteGraph(sdfg);
                    }
                });
            }
        } else if (valProp instanceof CodeProperty) {
            valProp.getCodeInput().on('change', () => {
                if (valProp) {
                    valProp.update();
                    const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                    if (!xform && sdfg)
                        vscodeWriteGraph(sdfg);
                }
            });
            valProp.getLangInput().on('change', () => {
                if (valProp) {
                    valProp.update();
                    const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                    if (!xform && sdfg)
                        vscodeWriteGraph(sdfg);
                }
            });
        }
    }

    if (updateOnChange && keyProp !== undefined &&
        keyProp.getInput() !== undefined)
        keyProp.getInput().on('change', () => {
            const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
            if (keyProp && keyProp.update() && !xform && sdfg)
                vscodeWriteGraph(sdfg);
        });

    return {
        keyProp: keyProp,
        valProp: valProp,
        deleteBtn: deleteBtn,
        row: row,
    };
}

export function generateAttributesTable(
    elem: any | undefined, xform: any | undefined, root: JQuery<HTMLElement>
): void {
    let attributes: any | undefined = undefined;
    let identifier = '';
    if (elem) {
        if (elem.data) {
            if (elem.data.attributes) {
                attributes = elem.data.attributes;
                identifier = elem.data.type;
            } else if (elem.data.node) {
                attributes = elem.data.node.attributes;
                identifier = elem.data.node.type;
            } else if (elem.data.state) {
                attributes = elem.data.state.attributes;
                identifier = elem.data.state.type;
            }
        } else {
            attributes = elem.attributes;
            identifier = elem.type;
        }
    } else if (xform) {
        attributes = xform;
        identifier = xform.transformation;
    }

    let metadata: any | undefined = undefined;
    if (elem)
        metadata = getElementMetadata(elem);
    else if (xform)
        metadata = getTransformationMetadata(xform);

    let sortedAttributes: { [key: string]: any } = {};
    Object.keys(attributes).forEach(k => {
        const val = attributes[k];
        if (k === 'layout' || k === 'sdfg' || k === 'sdfg_id' ||
            k === 'state_id' || k === 'expr_index' || k === 'type' ||
            k === 'transformation' || k === 'docstring' ||
            k === 'is_collapsed' || k === 'orig_sdfg' || k === 'position' ||
            k === 'transformation_hist' || k.startsWith('_'))
            return;

        if (metadata && metadata[k]) {
            if (!sortedAttributes[metadata[k]['category']])
                sortedAttributes[metadata[k]['category']] = {};
            sortedAttributes[metadata[k]['category']][k] = val;
        } else {
            if (!sortedAttributes['Uncategorized'])
                sortedAttributes['Uncategorized'] = {};
            sortedAttributes['Uncategorized'][k] = val;
        }
    });

    const attrTableBaseContainer = $('<div>', {
        'class': 'container-fluid attr-table-base-container',
    }).appendTo(root);

    Object.keys(sortedAttributes).forEach(category => {
        if (category === '(Debug)')
            return;
        if (!Object.keys(sortedAttributes[category]).length)
            return;

        const catRow = $('<div>', {
            'class': 'row attr-table-cat-row',
        }).appendTo(attrTableBaseContainer);
        const catContainer = $('<div>', {
            'class': 'col-12 attr-table-cat-container',
        }).appendTo(catRow);

        const catToggleBtn = $('<button>', {
            'class': 'attr-cat-toggle-btn active',
            'type': 'button',
            'text': category,
            'data-bs-toggle': 'collapse',
            'data-bs-target': '#info-table-' + category + '-' + identifier,
            'aria-expanded': 'false',
            'aria-controls': 'info-table-' + category + '-' + identifier,
        }).appendTo(catContainer);
        $('<i>', {
            'class': 'attr-cat-toggle-btn-indicator material-icons',
            'text': 'expand_less'
        }).appendTo(catToggleBtn);

        const attrTable = $('<div>', {
            'class': 'container-fluid attr-table collapse show',
            'id': 'info-table-' + category + '-' + identifier,
        }).appendTo(catContainer);

        attrTable.on('hide.bs.collapse', () => {
            catToggleBtn.removeClass('active');
        });
        attrTable.on('show.bs.collapse', () => {
            catToggleBtn.addClass('active');
        });

        Object.keys(sortedAttributes[category]).forEach(k => {
            const val = attributes[k];

            // Debug info isn't printed in the attributes table, but instead we
            // show a button to jump to the referenced code location.
            if (k === 'debuginfo') {
                if (val) {
                    const gotoSourceBtn = $('#goto-source-btn');
                    gotoSourceBtn.on('click', function() {
                        VSCodeSDFV.getInstance().gotoSource(
                            val.filename,
                            val.start_line,
                            val.start_column,
                            val.end_line,
                            val.end_column
                        );
                    });
                    gotoSourceBtn.prop(
                        'title',
                        val.filename + ':' + val.start_line
                    );
                    gotoSourceBtn.show();
                }
                return;
            }

            let attrMeta = undefined;
            if (metadata && metadata[k])
                attrMeta = metadata[k];

            attributeTablePutEntry(
                k, val, attrMeta, attributes, elem, xform, attrTable, false,
                true, false
            );
        });
    });

    // Dsiplay a button to jump to the generated C++ code
    if (
        elem instanceof SDFGElement &&
        !(elem instanceof Edge) &&
        !(elem instanceof Connector)
    ) {
        const gotoCppBtn = $('#goto-cpp-btn');
        const undefinedVal = -1;
        let sdfgName =
            VSCodeRenderer.getInstance()?.get_sdfg()?.attributes.name;
        let sdfgId = elem.sdfg.sdfg_list_id;
        let stateId = undefinedVal;
        let nodeId = undefinedVal;

        if (elem instanceof State) {
            stateId = elem.id;
        }
        else if (elem instanceof Node) {
            if (elem.parent_id === null)
                stateId = undefinedVal;
            else
                stateId = elem.parent_id;
            nodeId = elem.id;
        }

        gotoCppBtn.on('click', function () {
            VSCodeSDFV.getInstance().gotoCpp(
                sdfgName,
                sdfgId,
                stateId,
                nodeId
            );
        });
        gotoCppBtn.prop(
            'title',
            sdfgName + ':' +
                sdfgId +
                (stateId === undefinedVal) ? '' : (':' + stateId +
                    (nodeId === undefinedVal) ? '' : (':' + nodeId))
        );
        gotoCppBtn.show();
    }
}

function getMonacoThemeName() {
    switch ($('body').attr('data-vscode-theme-kind')) {
        case 'vscode-light':
            return 'vs';
        case 'vscode-high-contrast':
            return 'hs-black';
        case 'vscode-dark':
        default:
            return 'vs-dark';
    }
}