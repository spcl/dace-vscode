// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    AccessNode,
    EntryNode,
    ExitNode,
    find_graph_element_by_uuid,
    get_uuid_graph_element,
    JsonSDFG,
    ScopeNode,
    SDFGElement,
    sdfg_range_elem_to_string,
} from '@spcl/sdfv/out';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { VSCodeSDFV } from '../vscode_sdfv';

declare const vscode: any;

/**
 * Perform an action for each element in an array given by their uuids.
 */
export function doForAllUUIDs(
    uuids: string[], action: CallableFunction
): void {
    uuids.forEach((uuid) => {
        const result = find_graph_element_by_uuid(
            VSCodeRenderer.getInstance()?.get_graph(), uuid
        );

        let element = undefined;
        if (result !== undefined)
            element = result.element;

        if (element !== undefined) {
            action(element);
            const parent = element.parent;
            if (element.type().endsWith('Entry') && parent !== undefined) {
                const state = element.sdfg.nodes[element.parent_id];
                if (state.scope_dict[element.id] !== undefined) {
                    for (const nId of state.scope_dict[element.id])
                        action(parent.node(nId));
                }
            }
        }
    });
}

/**
 * Focus the view on a set of elements given by their uuids.
 */
export function zoomToUUIDs(uuids: string[]): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer) {
        const elementsToDisplay: SDFGElement[] = [];
        doForAllUUIDs(
            uuids, (element: SDFGElement) => elementsToDisplay.push(element)
        );
        renderer.zoom_to_view(elementsToDisplay);
    }
}

/**
 * Shade all elements in an array of element uuids with a light highlight color.
 * 
 * @param {*} uuids     Elements to shade.
 * @param {*} color     Color with which to highlight (defaults to wheat).
 */
export function highlightUUIDs(
    uuids: string[], pColor?: string
): void {
    const renderer = VSCodeRenderer.getInstance();
    const context = renderer?.get_context();
    if (renderer && context) {
        // Make sure no previously shaded elements remain shaded by drawing
        // synchronously.
        renderer.draw(null);

        let color = 'wheat';
        if (pColor !== undefined)
            color = pColor;

        if (!uuids.length) {
            renderer.get_graph()?.nodes().forEach((stateId: string) => {
                renderer.get_graph()?.node(stateId).shade(
                    renderer,
                    context,
                    color
                );
            });
        } else {
            doForAllUUIDs(uuids, (element: SDFGElement) => {
                element.shade(renderer, context, color);
            });
        }
    }
}

export function createSingleUseModal(
    title: string, withConfirm: boolean, bodyClass: string
): { modal: any, body: JQuery, confirmBtn: JQuery | undefined, modalId: string } {
    const randomDivId = Math.random().toString(36).replace('0.', 'su-div-');
    const propEditModal = $('<div>', {
        'class': 'modal fade',
        'role': 'dialog',
        'id': randomDivId,
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
        modalId: randomDivId,
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

export function elementUpdateLabel(
    element: SDFGElement, attributes: any
): void {
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
                element.clear_cached_labels();
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
            VSCodeSDFV.getInstance().fillInfo(newElem);
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
