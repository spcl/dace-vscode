// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    AccessNode,
    Edge,
    EntryNode,
    ExitNode,
    findGraphElementByUUID,
    getGraphElementUUID,
    JsonSDFG,
    JsonSDFGNode,
    JsonSDFGState,
    ScopeNode,
    SDFGElement,
    SDFGElementType,
    sdfg_range_elem_to_string,
    SDFGNode,
    CFGListType,
    JsonSDFGElement,
    JsonSDFGControlFlowRegion,
    JsonSDFGBlock,
} from '@spcl/sdfv/src';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';

export function findMaximumSdfgId(sdfg: JsonSDFG): number {
    let maxId = sdfg.cfg_list_id;
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

export function jsonSDFGElemReadAttr(elem: JsonSDFGElement, attr: string): any {
    if (Object.hasOwn(elem.attributes, attr))
        return elem.attributes[attr];
    const meta = VSCodeSDFV.getInstance().getCachedMetaDict();
    if (!meta)
        return undefined;
    const attrMeta = meta[elem.type][attr];
    if (attrMeta && Object.hasOwn(attrMeta, 'default'))
        return attrMeta.default;
    return undefined;
}

export function isCollapsible(elem: JsonSDFGElement): boolean {
    if (Object.hasOwn(elem.attributes, 'is_collapsed'))
        return true;
    const meta = VSCodeSDFV.getInstance().getCachedMetaDict();
    if (!meta)
        return false;
    return Object.hasOwn(meta[elem.type], 'is_collapsed');
}

export function findJsonSDFGElementByUUID(cfgList: CFGListType, uuid: string): [
    JsonSDFGElement | undefined, JsonSDFGControlFlowRegion
] {
    const rootSDFG = cfgList[0].jsonObj;
    const parts = uuid?.split('/');
    if (!parts || parts.length < 2 || parts.length > 4)
        return [undefined, rootSDFG];

    const sdfgId = parseInt(parts[0]);
    if (sdfgId >= 0 && rootSDFG) {
        const cfg = cfgList[sdfgId]?.jsonObj;
        const stateId = parseInt(parts[1]);
        if (stateId >= 0 && cfg?.nodes) {
            const state = cfg.nodes[stateId];
            if (state) {
                if (parts.length > 2) {
                    const nodeId = parseInt(parts[2]);
                    if (nodeId >= 0) {
                        return [state.nodes[nodeId], cfg];
                    } else if (parts.length === 4) {
                        const edgeId = parseInt(parts[3]);
                        if (edgeId >= 0)
                            return [state.edges[edgeId], cfg];
                    }
                }

                return [state, cfg];
            }
        } else if (parts.length === 4 && cfg?.edges) {
            const edgeId = parseInt(parts[3]);
            if (edgeId > 0)
                return [cfg.edges[edgeId], cfg];
        }
        return [cfg, rootSDFG];
    }
    return [undefined, rootSDFG];
}

function recursiveDoForScopeChildren(
    element: SDFGNode, action: CallableFunction
): void {
    const stateId = element.parent_id;
    if (element instanceof EntryNode && stateId !== null &&
        !element.attributes().is_collapsed) {
        const state = element.cfg?.nodes[stateId] as JsonSDFGState;
        if (state?.scope_dict[element.id] !== undefined) {
            const stateGraph = element.parentElem?.data.graph;
            if (!stateGraph) {
                throw Error(
                    'State graph missing on node' + element.label()
                );
            }
            for (const nId of state.scope_dict[element.id]) {
                const nd = stateGraph.node(nId);
                action(nd);
                recursiveDoForScopeChildren(nd, action);
            }
        }
    }
}

/**
 * Perform an action for each element in an array given by their uuids.
 */
export function doForAllUUIDs(
    uuids: string[], action: CallableFunction,
    applyToScopeChildren: boolean = false, applyToUndef: boolean = false
): void {
    const renderer = VSCodeRenderer.getInstance();
    if (!renderer)
        return;
    uuids.forEach((uuid) => {
        const element = findGraphElementByUUID(renderer.getCFGList(), uuid);

        if (element || applyToUndef) {
            action(element);

            // For scope entry nodes (e.g., maps), apply the action to all scope
            // children if the corresponding parameter is set. If the scope is
            // collapsed, skip.
            if (applyToScopeChildren && element instanceof SDFGNode)
                recursiveDoForScopeChildren(element, action);
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
            uuids, (element: SDFGElement) => elementsToDisplay.push(element),
            true
        );
        renderer.zoom_to_view(elementsToDisplay);
    }
}

/**
 * Shade all elements in an array of element uuids with a light highlight color.
 *
 * @param {*} uuids     Elements to shade.
 * @param {*} pColor    Color with which to highlight (defaults to wheat).
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
                if (element) {
                    element.shade(renderer, context, color);
                } else {
                    renderer.get_graph()?.nodes().forEach(sId => {
                        renderer.get_graph()?.node(sId).shade(
                            renderer, context, color
                        );
                    });
                }
            }, true, true);
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
    const renderer = VSCodeRenderer.getInstance();
    if (element.data && renderer) {
        if (element.data.node) {
            if (attributes.label)
                element.data.node.label = attributes.label;

            if (element instanceof ScopeNode) {
                // In scope nodes the range is attached.
                if (element instanceof EntryNode) {
                    const exitElem = findGraphElementByUUID(
                        renderer.getCFGList(),
                        element.sdfg.cfg_list_id + '/' +
                        element.parent_id + '/' +
                        element.data.node.scope_exit + '/-1'
                    );
                    if (exitElem && exitElem instanceof SDFGElement) {
                        element.data.node.label = computeScopeLabel(element);
                        exitElem.data.node.label = element.data.node.label;
                    }
                } else if (element instanceof ExitNode) {
                    const entryElem = findGraphElementByUUID(
                        renderer.getCFGList(),
                        element.sdfg.cfg_list_id + '/' +
                        element.parent_id + '/' +
                        element.data.node.scope_entry + '/-1'
                    );
                    if (entryElem && entryElem instanceof EntryNode) {
                        element.data.node.label = computeScopeLabel(entryElem);
                        entryElem.data.node.label = element.data.node.label;
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
export function unGraphiphySdfg(sdfg: JsonSDFG): void {
    const unGraphiphyGraph = (g: any) => {
        g.edges?.forEach((e: any) => {
            if (e.attributes.data.edge)
                delete e.attributes.data.edge;
        });

        g.nodes?.forEach((s: any) => {
            if (s.attributes.layout)
                delete s.attributes.layout;

            if (s.type === SDFGElementType.NestedSDFG)
                unGraphiphySdfg(s.attributes.sdfg);
            else
                unGraphiphyGraph(s);
        });
    };
    
    unGraphiphyGraph(sdfg);
}

export async function vscodeWriteGraph(g: JsonSDFG): Promise<void> {
    const t1 = performance.now();
    unGraphiphySdfg(g);
    const t2 = performance.now();
    // Stringify with a replacer that removes undefined and sets it to null,
    // so the values don't get dropped.
    const nv = JSON.stringify(g, (_k, v) => {
        return v === undefined ? null : v;
    }, 1);
    const t3 = performance.now();
    if (VSCodeSDFV.getInstance().getViewingCompressed())
        await SDFVComponent.getInstance().invoke('onSDFGEdited', []);
    else
        await SDFVComponent.getInstance().invoke('onSDFGEdited', [nv]);
    const t4 = performance.now();
    console.debug('unGraphiphySdfg took ' + (t2 - t1) + 'ms');
    console.debug('JSON.stringify took ' + (t3 - t2) + 'ms');
    console.debug('writeToActiveDocument took ' + (t4 - t3) + 'ms');
}

export function reselectRendererElement(elem: SDFGElement): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer) {
        const uuid = getGraphElementUUID(elem);
        const newElem = findGraphElementByUUID(renderer.getCFGList(), uuid);
        if (newElem && newElem instanceof SDFGElement)
            VSCodeSDFV.getInstance().fillInfo(newElem);
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

export function readDaCeProp(
    obj: Record<string, unknown>, key: string,
    meta: Record<string, { default: unknown }>
): { val: unknown, isNonDefault: boolean } {
    const isNonDefault = obj[key] !== undefined;
    const val = isNonDefault ? obj[key] : meta[key]?.default;
    return { val, isNonDefault };
}

export async function readElementProp(
    elem: Record<string, unknown>, key: string
): Promise<{ val: unknown, isNonDefault: boolean }> {
    return getElementMetadata(elem).then(meta => {
        return readDaCeProp(elem, key, meta);
    });
}

export async function readTransformationProp(
    xform: Record<string, unknown>, key: string
): Promise<{ val: unknown, isNonDefault: boolean }> {
    return getTransformationMetadata(xform).then(meta => {
        return readDaCeProp(xform, key, meta);
    });
}

export function doForAllNodeTypes(
    cfg: JsonSDFGControlFlowRegion, type: string,
    fun: (node: JsonSDFGNode | JsonSDFGBlock) => void, recurseNested: boolean
): void {
    cfg.nodes.forEach(block => {
        if (block.type === type)
            fun(block);

        if (block.type === SDFGElementType.SDFGState) {
            block.nodes.forEach(node => {
                if (node.type === type)
                    fun(node);

                if (node.type === SDFGElementType.NestedSDFG && recurseNested) {
                    doForAllNodeTypes(
                        node.attributes.sdfg, type, fun, recurseNested
                    );
                }
            });
        } else {
            doForAllNodeTypes(
                block as JsonSDFGControlFlowRegion, type, fun, recurseNested
            );
        }
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
