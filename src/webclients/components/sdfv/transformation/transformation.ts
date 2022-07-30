// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { JsonTransformation } from '../../transformations/transformations';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { generateAttributesTable } from '../utils/attributes_table';
import { highlightUUIDs, zoomToUUIDs } from '../utils/helpers';
import { VSCodeSDFV } from '../vscode_sdfv';

declare const vscode: any;

/**
 * Get the set of element uuids affected by a given transformation.
 */
export function transformationGetAffectedUUIDs(
    transformation: JsonTransformation
): string[] {
    const uuids = [];
    if (transformation._subgraph !== undefined)
        for (const id of Object.values(transformation._subgraph)) {
            if (transformation.state_id === -1)
                uuids.push(
                    transformation.sdfg_id + '/' +
                    id + '/-1/-1'
                );
            else
                uuids.push(
                    transformation.sdfg_id + '/' +
                    transformation.state_id + '/' + id +
                    '/-1'
                );
        }
    else
        uuids.push('-1/-1/-1/-1');
    return uuids;
}

export function getCleanedSelectedElements(): string {
    const cleanedSelected: {
        type: string,
        stateId: number | null,
        sdfgId: number,
        id: number,
    }[] = [];
    VSCodeRenderer.getInstance()?.get_selected_elements().forEach(element => {
        let type = 'other';
        if (element.data !== undefined && element.data.node !== undefined)
            type = 'node';
        else if (element.data !== undefined && element.data.state !== undefined)
            type = 'state';

        cleanedSelected.push({
            type: type,
            stateId: element.parent_id,
            sdfgId: element.sdfg.sdfg_list_id,
            id: element.id,
        });
    });
    return JSON.stringify(cleanedSelected);
}

/**
 * Request a list of applicable transformations from DaCe.
 */
export function getApplicableTransformations(): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer !== null && vscode !== undefined) {
        vscode.postMessage({
            type: 'dace.load_transformations',
            sdfg: VSCodeSDFV.getInstance().getSdfgString(),
            selectedElements: getCleanedSelectedElements(),
        });
    }
}

/**
 * Asynchronouly sort the list of transformations in the timing thread.
 *
 * @param {*} callback  Callback to call when sorting has been completed.
 */
export async function sortTransformations(
    callback: CallableFunction, ...args: any[]
): Promise<void> {
    setTimeout(() => {
        const selectedXforms: JsonTransformation[] = [];
        const viewportXforms: JsonTransformation[] = [];
        const globalXforms: JsonTransformation[] = [];
        const uncatXforms: JsonTransformation[] = [];

        const renderer = VSCodeRenderer.getInstance();
        if (!renderer)
            return;

        const selectedElements = renderer.get_selected_elements();
        const clearSubgraphXforms = selectedElements.length <= 1;

        const allXforms: JsonTransformation[] = [];
        for (const cat of VSCodeSDFV.getInstance().getTransformations())
            for (const transformation of cat)
                allXforms.push(transformation);

        const visibleElements = renderer.visible_elements();

        for (const xform of allXforms) {
            // Subgraph Transformations always apply to the selection.
            if (xform.type === 'SubgraphTransformation') {
                if (!clearSubgraphXforms)
                    selectedXforms.push(xform);
                continue;
            }

            let matched = false;
            if (xform.state_id !== undefined && xform.state_id >= 0) {
                // Matching a node.
                if (xform._subgraph) {
                    for (const nid of Object.values(xform._subgraph)) {
                        if (selectedElements.filter((e) => {
                                return (e.data.node !== undefined) &&
                                    e.sdfg.sdfg_list_id === xform.sdfg_id &&
                                    e.parent_id === xform.state_id &&
                                    e.id === Number(nid);
                            }).length > 0) {
                            selectedXforms.push(xform);
                            matched = true;
                            break;
                        }
                    }

                    if (!matched) {
                        for (const nid of Object.values(xform._subgraph)) {
                            if (visibleElements.filter((e) => {
                                    return e.type === 'node' &&
                                        e.sdfg_id === xform.sdfg_id &&
                                        e.state_id === xform.state_id &&
                                        e.id === Number(nid);
                                }).length > 0) {
                                viewportXforms.push(xform);
                                matched = true;
                                break;
                            }
                        }
                    }
                }
            } else {
                if (xform._subgraph) {
                    for (const nid of Object.values(xform._subgraph)) {
                        if (selectedElements.filter((e) => {
                                return (e.data.state !== undefined) &&
                                    e.sdfg.sdfg_list_id === xform.sdfg_id &&
                                    e.id === Number(nid);
                            }).length > 0) {
                            selectedXforms.push(xform);
                            matched = true;
                            break;
                        }
                    }

                    if (!matched) {
                        for (const nid of Object.values(xform._subgraph)) {
                            if (visibleElements.filter((e) => {
                                    return e.type === 'state' &&
                                        e.sdfg_id === xform.sdfg_id &&
                                        e.id === Number(nid);
                                }).length > 0) {
                                viewportXforms.push(xform);
                                matched = true;
                                break;
                            }
                        }
                    }
                }
            }

            // Sort in global transformations.
            if (!matched && xform.state_id === -1 &&
                Object.keys(xform._subgraph).length === 0) {
                globalXforms.push(xform);
                matched = true;
            }

            if (!matched)
                uncatXforms.push(xform);
        }

        const xformLists: [
            JsonTransformation[],
            JsonTransformation[],
            JsonTransformation[],
            JsonTransformation[],
        ] = [
            selectedXforms,
            viewportXforms,
            globalXforms,
            uncatXforms,
        ];

        for (const xformList of xformLists) {
            xformList.sort((a, b) => {
                const sgXformType = 'SubgraphTransformation';

                const aName = a.transformation;
                const bName = b.transformation;
                if (aName !== undefined && bName !== undefined) {
                    if (a.type === sgXformType && b.type !== sgXformType)
                        return -1;
                    else if (a.type !== sgXformType && b.type === sgXformType)
                        return 1;
                    else
                        return aName.localeCompare(bName);
                } else if (aName !== undefined && bName === undefined) {
                    return -1;
                } else if (aName === undefined && bName !== undefined) {
                    return 1;
                }

                return 0;
            });
        }

        VSCodeSDFV.getInstance().setTransformations(xformLists);

        // Call the callback function if one was provided.
        if (callback !== undefined)
            callback(...args);
    }, 0);
}

/**
 * Refresh the list of transformations shown in VSCode's transformation pane.
 */
export function refreshTransformationList(hideLoading: boolean = false): void {
    const transformations = VSCodeSDFV.getInstance().getTransformations();
    if (vscode !== undefined && transformations !== undefined)
        if (VSCodeSDFV.getInstance().getViewingHistoryState())
            vscode.postMessage({
                type: 'transformation_list.clear_transformations',
                reason:
                    'Can\'t show transformations while viewing a history state',
            });
        else
            vscode.postMessage({
                type: 'transformation_list.set_transformations',
                transformations: transformations,
                hideLoading: hideLoading,
            });
}

export function clearSelectedTransformation(): void {
    if (VSCodeSDFV.getInstance().getSelectedTransformation() !== null)
        VSCodeSDFV.getInstance().clearInfoBox();
}

/**
 * For a given transformation, show its details pane in the information area.
 *
 * This pane allows the further interaction with the transformation.
 *
 * @param {*} xform     The transformation to display.
 */
export function showTransformationDetails(xform: any): void {
    $('#goto-source-btn').hide();
    $('#goto-cpp-btn').hide();

    $('#info-title').text(xform.transformation);

    const infoContents = $('#info-contents');
    infoContents.html('');

    const xformButtonContainer = $('<div>', {
        class: 'transformation-button-container',
    }).appendTo(infoContents);

    const xformInfoContainer = $('<div>', {
        class: 'transformation-info-container',
    }).appendTo(infoContents);

    //let doc_lines = trafo.docstring.split('\n');
    // TODO: Docstring's formatting goes down the gutter
    // this way. Find a way to pretty print it.
    $('<p>', {
        class: 'transformation-description-text',
        text: xform.docstring,
    }).appendTo(xformInfoContainer);

    const xformImage = $('<object>', {
        class: 'transformation-image',
        type: 'image/gif',
    }).appendTo(xformInfoContainer);
    xformImage.attr(
        'data',
        'https://spcl.github.io/dace/transformations/' +
        xform.transformation + '.gif'
    );

    const affectedIds = transformationGetAffectedUUIDs(xform);
    zoomToUUIDs(affectedIds);

    $('<div>', {
        class: 'button',
        click: () => {
            zoomToUUIDs(affectedIds);
        },
        mouseenter: () => {
            highlightUUIDs(affectedIds);
        },
        mouseleave: () => {
            VSCodeRenderer.getInstance()?.draw_async();
        },
    }).append($('<span>', {
        'text': 'Zoom to area',
    })).appendTo(xformButtonContainer);

    $('<div>', {
        class: 'button',
        click: () => {
            if (vscode)
                vscode.postMessage({
                    type: 'dace.preview_transformation',
                    transformation: xform,
                });
        },
        mouseenter: () => {
            highlightUUIDs(affectedIds);
        },
        mouseleave: () => {
            VSCodeRenderer.getInstance()?.draw_async();
        },
    }).append($('<span>', {
        'text': 'Preview',
    })).appendTo(xformButtonContainer);

    $('<div>', {
        class: 'button',
        click: () => {
            applyTransformations(xform);
        },
        mouseenter: () => {
            highlightUUIDs(affectedIds);
        },
        mouseleave: () => {
            VSCodeRenderer.getInstance()?.draw_async();
        },
    }).append($('<span>', {
        'text': 'Apply',
    })).appendTo(xformButtonContainer);

    $('<div>', {
        class: 'button',
        click: () => {
            vscode.postMessage({
                type: 'dace.export_transformation_to_file',
                transformation: xform,
            });
        },
    }).append($('<span>', {
        text: 'Export To File',
    })).appendTo(xformButtonContainer);

    generateAttributesTable(undefined, xform, infoContents);
}

export function applyTransformations(...xforms: JsonTransformation[]): void {
    if (vscode) {
        VSCodeRenderer.getInstance()?.clearSelectedItems();
        VSCodeSDFV.getInstance().clearInfoBox();
        const el = document.getElementById('exit-preview-button');
        if (el)
            el.className = 'button hidden';
        vscode.postMessage({
            type: 'dace.apply_transformations',
            transformations: xforms,
        });
    }
}
