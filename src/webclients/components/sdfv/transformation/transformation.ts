// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { JsonTransformation, JsonTransformationGroup, JsonTransformationList } from '../../transformations/transformations';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { generateAttributesTable } from '../utils/attributes_table';
import { highlightUUIDs, zoomToUUIDs } from '../utils/helpers';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';

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
export async function getApplicableTransformations(): Promise<any[]> {
    return SDFVComponent.getInstance().invoke(
        'loadTransformations', [
            VSCodeSDFV.getInstance().getSdfgString(),
            getCleanedSelectedElements(),
        ]
    );
}

export async function refreshXform(sdfv: VSCodeSDFV): Promise<void> {
    clearSelectedTransformation();
    return getApplicableTransformations().then(transformations => {
        sdfv.setDaemonConnected(true);
        if (transformations !== undefined)
            sdfv.setTransformations({
                selection: [],
                viewport: [],
                passes: [],
                uncategorized: [{
                    title: 'Uncategorized',
                    ordering: 0,
                    xforms: transformations,
                }],
            });
        else
            sdfv.setTransformations({
                selection: [],
                viewport: [],
                passes: [],
                uncategorized: [],
            });

        sortTransformations(true, refreshTransformationList, true);
    });
}

/**
 * Asynchronouly sort the list of transformations in the timing thread.
 *
 * @param {*} callback  Callback to call when sorting has been completed.
 */
export async function sortTransformations(
    resortAll: boolean = true, callback: CallableFunction, ...args: any[]
): Promise<void> {
    // Run this asynchronosuly to not block the UI thread.
    setTimeout(() => {
        const sortedTransformations: JsonTransformationList = {
            'selection': [],
            'viewport': [],
            'passes': [],
            'uncategorized': [],
        };

        const renderer = VSCodeRenderer.getInstance();
        if (!renderer)
            return;

        const selectedElements = renderer.get_selected_elements();
        const clearSubgraphXforms = selectedElements.length <= 1;

        // Gather all transformations that need to be sorted. If the resortAll
        // flag is set, all transformations are sorted, otherwise passes are
        // skipped.
        const toSort: JsonTransformation[] = [];
        const categoriesToSort: (
            'selection' | 'viewport' | 'passes' | 'uncategorized'
        )[] = resortAll ?
            ['selection', 'viewport', 'passes', 'uncategorized'] :
            ['selection', 'viewport', 'uncategorized'];
        const currentXformList = VSCodeSDFV.getInstance().getTransformations();
        for (const category of categoriesToSort) {
            for (const group of currentXformList[category]) {
                for (const xform of group.xforms) {
                    if (clearSubgraphXforms &&
                        xform.type === 'SubgraphTransformation')
                        continue;
                    toSort.push(xform);
                }
            }
        }
        if (!resortAll) {
            for (const cat of currentXformList.passes)
                sortedTransformations.passes.push(cat);
        }

        // Sort each transformation into the respective category.
        const visibleElements = renderer.visible_elements();
        const buckets: {
            [key: string]: JsonTransformation[],
        } = {
            'selection': [],
            'viewport': [],
            'passes': [],
            'uncategorized': [],
        };
        for (const xform of toSort) {
            // Subgraph Transformations always apply to the selection.
            if (xform.type === 'SubgraphTransformation') {
                if (!clearSubgraphXforms)
                    buckets['selection'].push(xform);
                continue;
            } else if (xform.type === 'Pass' || xform.type === 'Pipeline') {
                buckets['passes'].push(xform);
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
                            buckets['selection'].push(xform);
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
                                buckets['viewport'].push(xform);
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
                            buckets['selection'].push(xform);
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
                                buckets['viewport'].push(xform);
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
                xform.CATEGORY = 'Global';
                buckets['viewport'].push(xform);
                matched = true;
            }

            if (!matched)
                buckets['uncategorized'].push(xform);
        }

        // Perform grouping inside each category and sort the groups.
        // For each group, perform sorting inside the group where applicable.
        for (const ct of categoriesToSort) {
            const groupDict: Map<string, JsonTransformationGroup> = new Map();
            for (const xform of buckets[ct]) {
                let groupName = xform.transformation;
                let groupOrdering = 0;
                if (xform.type === 'SubgraphTransformation') {
                    groupName = 'Subgraph Transformations';
                    groupOrdering = -1;
                } else if (xform.type === 'Pass' || xform.type === 'Pipeline') {
                    groupName = xform.CATEGORY ?? 'Others';
                } else if (xform.CATEGORY === 'Global') {
                    groupOrdering = 100;
                }

                if (groupDict.has(groupName))
                    groupDict.get(groupName)?.xforms.push(xform);
                else
                    groupDict.set(groupName, {
                        title: groupName,
                        ordering: groupOrdering,
                        xforms: [xform],
                    });
            }

            for (const [_, grp] of groupDict) {
                sortedTransformations[ct].push(grp);

                // Groups in the passes category are sorted pipelines first and
                // then all passes. The remaining groups are sorted
                // alphabetically.
                if (ct === 'passes') {
                    grp.xforms.sort((a, b) => {
                        if (a.type === 'Pipeline' && b.type !== 'Pipeline')
                            return -1;
                        else if (a.type !== 'Pipeline' && b.type === 'Pipeline')
                            return 1;

                        if (a.transformation > b.transformation)
                            return 1;
                        if (a.transformation < b.transformation)
                            return -1;
                        return 0;
                    });
                } else {
                    grp.xforms.sort();
                }
            }

            sortedTransformations[ct].sort((catA, catB) => {
                if (catA.ordering > catB.ordering)
                    return 1;
                if (catA.ordering < catB.ordering)
                    return -1;

                if (catA.title > catB.title)
                    return 1;
                if (catA.title < catB.title)
                    return -1;
                return 0;
            });
        }

        VSCodeSDFV.getInstance().setTransformations(sortedTransformations);

        // Call the callback function if one was provided.
        if (callback !== undefined)
            callback(...args);
    }, 0);
}

/**
 * Refresh the list of transformations shown in VSCode's transformation pane.
 */
export async function refreshTransformationList(
    hideLoading: boolean = false
): Promise<void> {
    const transformations = VSCodeSDFV.getInstance().getTransformations();
    if (transformations !== undefined)
        if (VSCodeSDFV.getInstance().getViewingHistoryState())
            await SDFVComponent.getInstance().invoke(
                'clearTransformations', [
                    'Can\'t show transformations while viewing a history state',
                ]
            );
        else
            await SDFVComponent.getInstance().invoke(
                'setTransformations', [transformations, hideLoading]
            );
}

export function clearSelectedTransformation(): void {
    if (VSCodeSDFV.getInstance().getSelectedTransformation() !== null)
        VSCodeSDFV.getInstance().clearInfoBox(true);
}

/**
 * For a given transformation, show its details pane in the information area.
 *
 * This pane allows the further interaction with the transformation.
 *
 * @param {*} xform     The transformation to display.
 */
export function showTransformationDetails(xform: JsonTransformation): void {
    $('#goto-source-btn').hide();
    $('#goto-cpp-btn').hide();

    VSCodeSDFV.getInstance().infoBoxSetTitle(xform.transformation);

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
    if (xform.type !== 'Pass' && xform.type !== 'Pipeline')
        zoomToUUIDs(affectedIds);

    if (xform.type !== 'Pass' && xform.type !== 'Pipeline')
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
            SDFVComponent.getInstance().invoke(
                'previewTransformation', [xform]
            );
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

    if (xform.type !== 'Pass' && xform.type !== 'Pipeline')
        $('<div>', {
            class: 'button',
            click: () => {
                SDFVComponent.getInstance().invoke(
                    'exportTransformation', [xform]
                );
            },
        }).append($('<span>', {
            text: 'Export To File',
        })).appendTo(xformButtonContainer);

    const tableContainer = $('<div>', {
        'class': 'container-fluid attr-table-base-container',
    }).appendTo(infoContents);
    generateAttributesTable(undefined, xform, tableContainer);

    VSCodeSDFV.getInstance().infoBoxShow(true);
}

export async function applyTransformations(
    ...xforms: JsonTransformation[]
): Promise<void> {
    VSCodeRenderer.getInstance()?.clearSelectedItems();
    VSCodeSDFV.getInstance().clearInfoBox(true);
    $('#exit-preview-button').hide();
    return SDFVComponent.getInstance().invoke(
        'applyTransformations', [xforms]
    );
}
