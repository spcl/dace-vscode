// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    AccessNode,
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
    SDFGNode,
    CFGListType,
    JsonSDFGElement,
    JsonSDFGControlFlowRegion,
    JsonSDFGBlock,
    sdfgRangeElemToString,
    SDFGRange,
    ControlFlowBlock,
    JsonSDFGCodeBlock,
    LibraryNode,
    InterstateEdge,
    JsonSDFGDataDesc,
} from '@spcl/sdfv/src';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';
import { MetaDictT } from '../../../../types';
import { WithAttributes } from './attributes_table';
import { Modal } from 'bootstrap';


export function findMaximumSdfgId(sdfg: JsonSDFG): number {
    let maxId = sdfg.cfg_list_id;
    for (const node of sdfg.nodes) {
        if (node.type === SDFGElementType.SDFGState.toString()) {
            for (const n of node.nodes ?? []) {
                if (n.type === SDFGElementType.NestedSDFG.toString()) {
                    if (n.attributes?.sdfg) {
                        maxId = Math.max(
                            findMaximumSdfgId(n.attributes.sdfg as JsonSDFG),
                            maxId
                        );
                    }
                }
            }
        }
    }
    return maxId;
}

export function jsonSDFGElemReadAttr(elem: JsonSDFGElement, attr: string): any {
    if (elem.attributes && Object.hasOwn(elem.attributes, attr))
        return elem.attributes[attr];
    const meta = VSCodeSDFV.getInstance().getCachedMetaDict();
    if (!meta)
        return undefined;
    const elemMeta = meta[elem.type] as MetaDictT | undefined;
    const attrMeta = elemMeta?.[attr] as MetaDictT | undefined;
    if (attrMeta && 'default' in attrMeta)
        return attrMeta.default;
    return undefined;
}

export function isCollapsible(elem: JsonSDFGElement): boolean {
    if (elem.attributes && 'is_collapsed' in elem.attributes)
        return true;
    const meta = VSCodeSDFV.getInstance().getCachedMetaDict();
    if (!meta)
        return false;
    return Object.hasOwn(meta[elem.type] ?? {}, 'is_collapsed');
}

export function findJsonSDFGElementByUUID(cfgList: CFGListType, uuid: string): [
    JsonSDFGElement | undefined, JsonSDFGControlFlowRegion
] {
    const rootSDFG = cfgList[0].jsonObj;
    const parts = uuid.split('/');
    if (parts.length < 2 || parts.length > 4)
        return [undefined, rootSDFG];

    const sdfgId = parseInt(parts[0]);
    if (sdfgId >= 0) {
        const cfg = cfgList[sdfgId].jsonObj;
        const stateId = parseInt(parts[1]);
        if (stateId >= 0) {
            const state = cfg.nodes[stateId];
            if (state.nodes) {
                if (parts.length > 2) {
                    const nodeId = parseInt(parts[2]);
                    if (nodeId >= 0) {
                        return [state.nodes[nodeId], cfg];
                    } else if (parts.length === 4) {
                        const edgeId = parseInt(parts[3]);
                        if (edgeId >= 0 && state.edges)
                            return [state.edges[edgeId], cfg];
                    }
                }

                return [state, cfg];
            }
        } else if (parts.length === 4) {
            const edgeId = parseInt(parts[3]);
            if (edgeId > 0)
                return [cfg.edges[edgeId], cfg];
        }
        return [cfg, rootSDFG];
    }
    return [undefined, rootSDFG];
}

function recursiveDoForScopeChildren(
    element: SDFGNode, action: (elem: SDFGNode | ControlFlowBlock) => unknown
): void {
    const stateId = element.parentStateId;
    if (element instanceof EntryNode && stateId !== undefined &&
        !element.attributes()?.is_collapsed) {
        const state = element.cfg?.nodes[stateId] as JsonSDFGState;
        if (state.scope_dict?.[element.id] !== undefined) {
            const stateGraph = element.parentElem?.graph;
            if (!stateGraph)
                throw Error('State graph missing on node' + element.label);
            for (const nId of state.scope_dict[element.id] ?? []) {
                const nd = stateGraph.node(nId.toString());
                if (nd) {
                    action(nd);
                    recursiveDoForScopeChildren(nd as SDFGNode, action);
                }
            }
        }
    }
}

/**
 * Perform an action for each element in an array given by their uuids.
 *
 * @param uuids                 Element UUIDs to perform the action for.
 * @param action                Action to perform for each element.
 * @param applyToScopeChildren  Perform the action for all elements in a scope,
 *                              when applying to a scope node (or state / nested
 *                              SDFG etc.). Defaults to false.
 * @param applyToUndef          Apply the action if no element was found for a
 *                              given UUID, i.e., the element is undefined.
 *                              Defaults to false.
 */
export function doForAllUUIDs(
    uuids: string[], action: (elem?: SDFGElement) => unknown,
    applyToScopeChildren: boolean = false, applyToUndef: boolean = false
): void {
    const renderer = VSCodeRenderer.getInstance();
    if (!renderer)
        return;
    uuids.forEach((uuid) => {
        const element = findGraphElementByUUID(renderer.cfgList, uuid);

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
            uuids, (element) => {
                if (element)
                    elementsToDisplay.push(element);
            }, true
        );
        renderer.zoomToFit(
            elementsToDisplay.length > 0 ? elementsToDisplay : undefined
        );
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
    const context = renderer?.ctx;
    if (renderer && context) {
        // Make sure no previously shaded elements remain shaded by drawing
        // synchronously.
        renderer.draw();

        let color = 'wheat';
        if (pColor !== undefined)
            color = pColor;

        if (!uuids.length) {
            for (const stateId of renderer.graph?.nodes() ?? [])
                renderer.graph!.node(stateId)?.shade(color);
        } else {
            doForAllUUIDs(uuids, (element) => {
                if (element) {
                    element.shade(color);
                } else {
                    for (const sId of renderer.graph?.nodes() ?? [])
                        renderer.graph!.node(sId)?.shade(color);
                }
            }, true, true);
        }
    }
}

export function createSingleUseModal(
    title: string, withConfirm: boolean, bodyClass: string
): {
    modalElement: JQuery,
    modal: Modal,
    body: JQuery,
    confirmBtn: JQuery | undefined,
    modalId: string,
} {
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
    if (withConfirm) {
        modalConfirmBtn = $('<button>', {
            'class': 'btn btn-primary',
            'type': 'button',
            'text': 'Ok',
        }).appendTo(modalFooter);
    }

    propEditModal.on('hidden.bs.modal', () => propEditModal.remove());

    return {
        modalElement: propEditModal,
        modal: new Modal(propEditModal[0], {}),
        body: modalBody,
        confirmBtn: modalConfirmBtn,
        modalId: randomDivId,
    };
}

export function computeScopeLabel(scopeEntry: EntryNode): string {
    const attributes = scopeEntry.attributes() as {
        range?: {
            ranges?: SDFGRange[];
        },
        params?: string[];
        label?: string;
    } | undefined;
    if (!attributes?.label)
        return scopeEntry.label;

    const baseLabel = attributes.label;

    const rangeSnippets = [];
    const rngs = attributes.range?.ranges;
    for (let i = 0; i < (rngs?.length ?? 0); i++) {
        let parameter = '_';
        if (i < (attributes.params?.length ?? 0))
            parameter = attributes.params![i];

        const range = attributes.range!.ranges![i];
        rangeSnippets.push(parameter + '=' + sdfgRangeElemToString(range));
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
    element: WithAttributes, attributes: Record<string, unknown>
): void {
    if (element instanceof InterstateEdge && element.data) {
        let condition = null;
        const attrs = element.attributes();
        const condCode =
            attrs?.condition as JsonSDFGCodeBlock | undefined;
        if (condCode?.string_data) {
            const strdata = condCode.string_data.toLowerCase();
            if (strdata !== '1' && strdata !== 'true')
                condition = strdata;
        }
        let assignments = null;
        const assignDict = attrs?.assignments as Record<
            string, string | number | boolean
        > | undefined;
        if (assignDict) {
            const assignList = [];
            for (const k in assignDict)
                assignList.push(k + '=' + assignDict[k].toString());
            assignments = assignList.join(', ');
        }
        let newLabel = '';
        if (condition)
            newLabel += (condition + (assignments ? '; ' : ''));
        if (assignments)
            newLabel += assignments;
        element.data.label = newLabel;
    } else if (element.jsonData) {
        if (attributes.label) {
            (element.jsonData as Record<string, unknown>).label =
                attributes.label;
        }

        if (element instanceof ScopeNode) {
            // In scope nodes the range is attached.
            if (element instanceof EntryNode) {
                const exitElem = findGraphElementByUUID(
                    element.renderer.cfgList,
                    element.sdfg.cfg_list_id.toString() + '/' +
                    (element.parentStateId?.toString() ?? '-1') + '/' +
                    (element.jsonData.scope_exit?.toString() ?? '-1') +
                    '/-1'
                );
                if (exitElem?.jsonData && exitElem instanceof SDFGElement) {
                    element.jsonData.label = computeScopeLabel(element);
                    exitElem.jsonData.label = element.jsonData.label;
                }
            } else if (element instanceof ExitNode) {
                const entryElem = findGraphElementByUUID(
                    element.renderer.cfgList,
                    element.sdfg.cfg_list_id.toString() + '/' +
                    (element.parentStateId?.toString() ?? '-1') + '/' +
                    (element.jsonData.scope_entry?.toString() ?? '-1') +
                    '/-1'
                );
                if (entryElem?.jsonData && entryElem instanceof EntryNode) {
                    element.jsonData.label = computeScopeLabel(entryElem);
                    entryElem.jsonData.label = element.jsonData.label;
                }
            }
            element.clearCachedLabels();
        } else if (element instanceof AccessNode && attributes.data) {
            element.jsonData.label = attributes.data as string;
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
    const unGraphiphyGraph = (g: JsonSDFGControlFlowRegion | JsonSDFGState) => {
        g.edges.forEach((e) => {
            const data =
                e.attributes?.data as Record<string, unknown> | undefined;
            if (data && 'edge' in data && data.edge)
                delete data.edge;
        });

        g.nodes.forEach((s) => {
            if (s.attributes?.layout)
                delete s.attributes.layout;

            if (s.type === SDFGElementType.NestedSDFG.toString()) {
                if (s.attributes?.sdfg)
                    unGraphiphySdfg(s.attributes.sdfg as JsonSDFG);
            } else if ('nodes' in s && 'edges' in s) {
                unGraphiphyGraph(
                    s as JsonSDFGControlFlowRegion | JsonSDFGState
                );
            }
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
        return v === undefined ? null : v as unknown;
    }, 1);
    const t3 = performance.now();
    if (VSCodeSDFV.getInstance().getViewingCompressed())
        await SDFVComponent.getInstance().invoke('onSDFGEdited', []);
    else
        await SDFVComponent.getInstance().invoke('onSDFGEdited', [nv]);
    const t4 = performance.now();
    console.debug('unGraphiphySdfg took ' + (t2 - t1).toString() + 'ms');
    console.debug('JSON.stringify took ' + (t3 - t2).toString() + 'ms');
    console.debug('writeToActiveDocument took ' + (t4 - t3).toString() + 'ms');
}

export function reselectRendererElement(elem: SDFGElement): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer) {
        const uuid = getGraphElementUUID(elem);
        const newElem = findGraphElementByUUID(renderer.cfgList, uuid);
        if (newElem && newElem instanceof SDFGElement) {
            VSCodeSDFV.getInstance().linkedUI.showElementInfo(
                newElem, VSCodeRenderer.getInstance()!
            );
        }
    }
}

export async function getTransformationMetadata(
    transformation: Record<string, unknown>
): Promise<MetaDictT> {
    if (transformation.transformation) {
        const mDict = await VSCodeSDFV.getInstance().getMetaDict();
        return mDict[transformation.transformation as string] as MetaDictT;
    }
    return {};
}

export async function getElementMetadata(
    elem: string | SDFGElement | JsonSDFGElement | JsonSDFGDataDesc
): Promise<MetaDictT> {
    const sdfgMetaDict = await VSCodeSDFV.getInstance().getMetaDict();
    if (typeof elem === 'string') {
        return sdfgMetaDict[elem] as MetaDictT;
    } else if (elem instanceof SDFGElement) {
        if (elem instanceof ScopeNode) {
            const elemType = elem.type;
            const nodeMeta = sdfgMetaDict[elemType] as MetaDictT | undefined;
            let scopeMeta: MetaDictT | undefined = undefined;
            const entryIdx = elemType.indexOf('Entry');
            const exitIdx = elemType.indexOf('Exit');
            if (entryIdx) {
                scopeMeta = sdfgMetaDict[
                    elemType.substring(0, entryIdx)
                ] as MetaDictT | undefined;
            } else if (exitIdx) {
                scopeMeta = sdfgMetaDict[
                    elemType.substring(0, exitIdx)
                ] as MetaDictT | undefined;
            }

            const metadata: MetaDictT = {};
            if (nodeMeta !== undefined) {
                Object.keys(nodeMeta).forEach(k => {
                    metadata[k] = nodeMeta[k];
                });
            }
            if (scopeMeta !== undefined) {
                Object.keys(scopeMeta).forEach(k => {
                    metadata[k] = scopeMeta[k];
                });
            }
            return metadata;
        } else if (elem instanceof LibraryNode) {
            const classpath = elem.jsonData?.classpath as string | undefined;
            if (classpath && sdfgMetaDict[classpath])
                return sdfgMetaDict[classpath] as MetaDictT;
        }
    }
    return sdfgMetaDict[elem.type ?? 'undefined'] as MetaDictT;
}

export function readDaCeProp(
    obj: unknown, key: string, meta: MetaDictT
): { val: unknown, isNonDefault: boolean } {
    const isObj = obj && typeof obj === 'object';
    if (isObj) {
        const objAsRecord = obj as Record<string, unknown>;
        const isNonDefault = objAsRecord[key] !== undefined;
        const val = isNonDefault ? objAsRecord[key] : (
            meta[key] as MetaDictT
        ).default;
        return { val, isNonDefault };
    }
    return { val: undefined, isNonDefault: false };
}

export async function readElementProp(
    elem: SDFGElement | JsonSDFGElement, key: string
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

        if (block.type === SDFGElementType.SDFGState.toString()) {
            block.nodes?.forEach(node => {
                if (node.type === type)
                    fun(node);

                if (node.type === SDFGElementType.NestedSDFG.toString() &&
                    recurseNested && node.attributes?.sdfg) {
                    doForAllNodeTypes(
                        node.attributes.sdfg as JsonSDFG, type, fun,
                        recurseNested
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

    private readonly container: JQuery;
    private readonly items: JQuery;

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
            callback: (() => void) | null,
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
        callback: (() => void) | null,
        disabled: boolean,
    }[]
): void {
    ContextMenu.getInstance().show(x, y, options);
}
