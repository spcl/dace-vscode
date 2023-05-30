// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    AccessNode,
    Edge,
    EntryNode,
    ExitNode,
    find_graph_element_by_uuid,
    get_uuid_graph_element,
    JsonSDFG,
    JsonSDFGEdge,
    JsonSDFGNode,
    JsonSDFGState,
    ScopeNode,
    SDFGElement,
    SDFGElementType,
    sdfg_range_elem_to_string,
} from '@spcl/sdfv/src';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';
import { gzipSync } from 'zlib';

declare const vscode: any;
declare const COMPRESSED_SDFG: boolean;

export function findMaximumSdfgId(sdfg: JsonSDFG): number {
    let maxId = sdfg.sdfg_list_id;
    for (const node of sdfg.nodes) {
        if (node.type === SDFGElementType.SDFGState)
            for (const n of node.nodes) {
                if (n.type === SDFGElementType.NestedSDFG)
                    maxId = Math.max(
                        findMaximumSdfgId(n.attributes.sdfg), maxId
                    );
            }
    }
    return maxId;
}

export function findSdfgById(sdfg: JsonSDFG, id: number): JsonSDFG | undefined {
    if (sdfg.sdfg_list_id === id)
        return sdfg;

    for (const node of sdfg.nodes) {
        if (node.type === SDFGElementType.SDFGState)
            for (const n of node.nodes) {
                if (n.type === SDFGElementType.NestedSDFG) {
                    const ret = findSdfgById(n.attributes.sdfg, id);
                    if (ret)
                        return ret;
        }
    }
    }
    return undefined;
}

export function findJsonSDFGElementByUUID(
    rootSdfg: JsonSDFG, uuid: string
): [
    JsonSDFG | JsonSDFGState | JsonSDFGNode | JsonSDFGEdge | undefined,
    JsonSDFG
] {
    const parts = uuid?.split('/');
    if (!parts || parts.length < 2 || parts.length > 4)
        return [undefined, rootSdfg];

    const sdfgId = parseInt(parts[0]);
    if (sdfgId >= 0 && rootSdfg) {
        const sdfg = findSdfgById(rootSdfg, sdfgId);
        const stateId = parseInt(parts[1]);
        if (stateId >= 0 && sdfg?.nodes) {
            const state = sdfg.nodes[stateId];
            if (state) {
                if (parts.length > 2) {
                    const nodeId = parseInt(parts[2]);
                    if (nodeId >= 0) {
                        return [state.nodes[nodeId], sdfg];
                    } else if (parts.length === 4) {
                        const edgeId = parseInt(parts[3]);
                        if (edgeId >= 0)
                            return [state.edges[edgeId], sdfg];
                    }
                }

                return [state, sdfg];
            }
        } else if (parts.length === 4 && sdfg?.edges) {
            const edgeId = parseInt(parts[3]);
            if (edgeId > 0)
                return [sdfg.edges[edgeId], sdfg];
        }
        return [sdfg, rootSdfg];
    }
    return [undefined, rootSdfg];
}

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
                    if (exitElem && exitElem.element) {
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
                    if (entryElem && entryElem.element) {
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
        } else if (element.data.label) {
            if (element instanceof Edge) {
                if (element.data.type === 'InterstateEdge') {
                    let condition = null;
                    if (element.data.attributes?.condition?.string_data) {
                        const strdata =
                            element.data.attributes.condition.string_data;
                        if (strdata !== '1' && strdata !== 1 &&
                            strdata !== 'true' && strdata !== true)
                            condition = strdata;
                    }
                    let assignments = null;
                    if (element.data.attributes?.assignments) {
                        const assignDict = element.data.attributes.assignments;
                        const assignList = [];
                        for (const k in assignDict)
                            assignList.push(
                                k.toString() + '=' + assignDict[k].toString()
                            );
                        assignments = assignList.join(', ');
                    }
                    let newLabel = '';
                    if (condition)
                        newLabel += (condition + (assignments ? '; ' : ''));
                    if (assignments)
                        newLabel += assignments;
                    element.data.label = newLabel;
                }
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

            if (v.type === SDFGElementType.NestedSDFG)
                unGraphiphySdfg(v.attributes.sdfg);
        });
    });
}

export async function vscodeWriteGraph(g: JsonSDFG): Promise<void> {
    const t1 = performance.now();
    unGraphiphySdfg(g);
    const t2 = performance.now();
    // Stringify with a replacer that removes undefined and sets it to null,
    // so the values don't get dropped.
    // TODO: Use indent level set by editorconfig?
    const nv = JSON.stringify(g, (_k, v) => {
        return v === undefined ? null : v;
    }, 2);
    const t3 = performance.now();
    if (COMPRESSED_SDFG)
        await SDFVComponent.getInstance().invoke('writeToCompressedSDFG', [
            gzipSync(nv)
        ]);
    else
        await SDFVComponent.getInstance().invoke('writeToActiveDocument', [nv]);
    const t4 = performance.now();
    console.debug('unGraphiphySdfg took ' + (t2 - t1) + 'ms');
    console.debug('JSON.stringify took ' + (t3 - t2) + 'ms');
    console.debug('writeToActiveDocument took ' + (t4 - t3) + 'ms');
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

export async function getTransformationMetadata(
    transformation: any
): Promise<{ [key: string ]: any}> {
    if (transformation.transformation)
        return VSCodeSDFV.getInstance().getMetaDict().then(sdfgMetaDict => {
            return sdfgMetaDict[transformation.transformation];
        });
    return {};
}

export async function getElementMetadata(
    elem: any
): Promise<{ [key: string ]: any}> {
    return VSCodeSDFV.getInstance().getMetaDict().then(sdfgMetaDict => {
        if (typeof elem === 'string') {
            return sdfgMetaDict[elem];
        } else if (elem instanceof SDFGElement) {
            if (elem.data.sdfg) {
                return sdfgMetaDict[elem.data.sdfg.type];
            } else if (elem.data.state) {
                return sdfgMetaDict[elem.data.state.type];
            } else if (elem.data.node) {
                const nodeType = elem.data.node.type;
                if (elem instanceof ScopeNode) {
                    let nodeMeta = sdfgMetaDict[nodeType];
                    let scopeMeta: any = undefined;
                    let entryIdx = nodeType.indexOf('Entry');
                    let exitIdx = nodeType.indexOf('Exit');
                    if (entryIdx)
                        scopeMeta = sdfgMetaDict[
                            nodeType.substring(0, entryIdx)
                        ];
                    else if (exitIdx)
                        scopeMeta = sdfgMetaDict[
                            nodeType.substring(0, exitIdx)
                        ];

                    const metadata: { [key: string]: any } = {};
                    if (nodeMeta !== undefined)
                        Object.keys(nodeMeta).forEach(k => {
                            metadata[k] = nodeMeta[k];
                        });
                    if (scopeMeta !== undefined)
                        Object.keys(scopeMeta).forEach(k => {
                            metadata[k] = scopeMeta[k];
                        });
                    return metadata;
                } else if (nodeType === 'LibraryNode') {
                    return sdfgMetaDict[elem.data.node.classpath];
                } else {
                    return sdfgMetaDict[nodeType];
                }
            } else if (elem.data.type) {
                return sdfgMetaDict[elem.data.type];
            }
        } else if (elem.type) {
            return sdfgMetaDict[elem.type];
        }
        return {};
    });
}

export function doForAllNodeTypes(
    sdfg: JsonSDFG, type: string, fun: CallableFunction, recurseNested: boolean
): void {
    sdfg.nodes.forEach(state => {
        if (type === 'SDFGState')
            fun(state);

        state.nodes.forEach((node: JsonSDFGNode) => {
            if (node.type && node.type === type)
                fun(node);
            else if (node.type && node.type === 'NestedSDFG' && recurseNested)
                doForAllNodeTypes(
                    node.attributes.sdfg, type, fun, recurseNested
                );
        });
    });
}

class ContextMenu {

    private static readonly INSTANCE = new ContextMenu();

    public static getInstance(): ContextMenu {
        return ContextMenu.INSTANCE;
    }

    private readonly container: JQuery<HTMLElement>;
    private readonly items: JQuery<HTMLElement>;

    private constructor() {
        $(document.body).on('click', () => {
            this.hide();
        });

        $(document.body).on('keydown', evt => {
            if (evt.key === 'Escape')
                this.hide();
        });

        this.container = $('<nav>', {
            class: 'context-menu',
        });
        this.items = $('<ul>', {
            class: 'context-menu-items',
        }).appendTo(this.container);

        this.container.hide();

        this.container.appendTo(document.body);
    }

    public show(
        x: number, y: number,
        opts: {
            label: string | null,
            callback: CallableFunction | null,
            disabled: boolean,
        }[]
    ): void {
        this.hide();

        for (const option of opts) {
            if (option.label === null || option.callback === null) {
                $('<li>', {
                    class: 'context-menu-separator',
                }).appendTo(this.items);
            } else {
                if (!option.disabled) {
                    const item = $('<li>', {
                        class: 'context-menu-item',
                        text: option.label,
                    }).appendTo(this.items);
                    item.on('click', () => {
                        if (option.callback)
                            option.callback();
                        this.hide();
                        return false;
                    });
                } else {
                    $('<li>', {
                        class: 'context-menu-item context-menu-item-disabled',
                        text: option.label,
                    }).appendTo(this.items);
                }
            }
        }

        this.container.css({
            left: x,
            top: y,
        });

        this.container.show();
    }

    public hide(): void {
        this.container.hide();
        this.items.html('');
    }

}

export function showContextMenu(
    x: number, y: number,
    options: {
        label: string | null,
        callback: CallableFunction | null,
        disabled: boolean,
    }[]
): void {
    ContextMenu.getInstance().show(x, y, options);
}
