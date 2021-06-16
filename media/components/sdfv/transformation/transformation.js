// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

/**
 * Get the set of element uuids affected by a given transformation.
 * 
 * @param {*} transformation    The transformation in question.
 * @returns                     An array of element uuids.
 */
function transformation_get_affected_uuids(transformation) {
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

function get_cleaned_selected_elements() {
    const cleaned_selected = [];
    daceRenderer.selected_elements.forEach(element => {
        let type = 'other';
        if (element.data !== undefined && element.data.node !== undefined)
            type = 'node';
        else if (element.data !== undefined && element.data.state !== undefined)
            type = 'state';

        cleaned_selected.push({
            'type': type,
            'state_id': element.parent_id,
            'sdfg_id': element.sdfg.sdfg_list_id,
            'id': element.id,
        });
    });
    return JSON.stringify(cleaned_selected);
}

/**
 * Request a list of applicable transformations from DaCe.
 */
function get_applicable_transformations() {
    if (daceRenderer !== undefined && daceRenderer !== null &&
        vscode !== undefined) {
        vscode.postMessage({
            type: 'dace.load_transformations',
            sdfg: sdfg_json,
            selectedElements: get_cleaned_selected_elements(),
        });
    }
}

/**
 * Asynchronouly sort the list of transformations in the timing thread.
 * 
 * @param {*} callback  Callback to call when sorting has been completed.
 */
async function sort_transformations(callback) {
    setTimeout(() => {
        const selected_transformations = [];
        const viewport_transformations = [];
        const global_transformations = [];
        const uncat_transformations = [];

        const clear_subgraph_trafos =
            daceRenderer.selected_elements.length <= 1;

        const all_transformations = [];
        for (const cat of transformations)
            for (const transformation of cat)
                all_transformations.push(transformation);

        const visible_elements = daceRenderer.visible_elements();

        for (const trafo of all_transformations) {
            // Subgraph Transformations always apply to the selection.
            if (trafo.type === 'SubgraphTransformation') {
                if (!clear_subgraph_trafos)
                    selected_transformations.push(trafo);
                continue;
            }

            let matched = false;
            if (trafo.state_id >= 0) {
                // Matching a node.
                if (trafo._subgraph) {
                    for (const node_id of Object.values(trafo._subgraph)) {
                        if (daceRenderer !== undefined &&
                            daceRenderer.selected_elements.filter((e) => {
                                return (e.data.node !== undefined) &&
                                    e.sdfg.sdfg_list_id === trafo.sdfg_id &&
                                    e.parent_id === trafo.state_id &&
                                    e.id === Number(node_id);
                            }).length > 0) {
                            selected_transformations.push(trafo);
                            matched = true;
                            break;
                        }
                    }

                    if (!matched) {
                        for (const node_id of Object.values(trafo._subgraph)) {
                            if (visible_elements.filter((e) => {
                                    return e.type === 'node' &&
                                        e.sdfg_id === trafo.sdfg_id &&
                                        e.state_id === trafo.state_id &&
                                        e.id === Number(node_id);
                                }).length > 0) {
                                viewport_transformations.push(trafo);
                                matched = true;
                                break;
                            }
                        }
                    }
                }
            } else {
                if (trafo._subgraph) {
                    for (const node_id of Object.values(trafo._subgraph)) {
                        if (daceRenderer !== undefined &&
                            daceRenderer.selected_elements.filter((e) => {
                                return (e.data.state !== undefined) &&
                                    e.sdfg.sdfg_list_id === trafo.sdfg_id &&
                                    e.id === Number(node_id);
                            }).length > 0) {
                            selected_transformations.push(trafo);
                            matched = true;
                            break;
                        }
                    }

                    if (!matched) {
                        for (const node_id of Object.values(trafo._subgraph)) {
                            if (visible_elements.filter((e) => {
                                    return e.type === 'state' &&
                                        e.sdfg_id === trafo.sdfg_id &&
                                        e.id === Number(node_id);
                                }).length > 0) {
                                viewport_transformations.push(trafo);
                                matched = true;
                                break;
                            }
                        }
                    }
                }
            }

            // Sort in global transformations.
            if (!matched && trafo.state_id === -1 &&
                Object.keys(trafo._subgraph).length === 0) {
                global_transformations.push(trafo);
                matched = true;
            }

            if (!matched)
                uncat_transformations.push(trafo);
        }

        transformations = [
            selected_transformations,
            viewport_transformations,
            global_transformations,
            uncat_transformations,
        ];

        // Call the callback function if one was provided. If additional
        // arguments are provided, forward them to the callback function.
        if (callback !== undefined) {
            if (arguments.length > 1) {
                let args = Array.from(arguments);
                args.shift();
                callback(...args);
            } else {
                callback();
            }
        }
    }, 0);
}

/**
 * Refresh the list of transformations shown in VSCode's transformation pane.
 */
function refresh_transformation_list(hide_loading = false) {
    if (vscode !== undefined && transformations !== undefined)
        if (window.viewing_history_state)
            vscode.postMessage({
                type: 'transformation_list.clear_transformations',
                reason: 'Can\'t show transformations while viewing a history state',
            });
        else
            vscode.postMessage({
                type: 'transformation_list.set_transformations',
                transformations: transformations,
                hide_loading: hide_loading,
            });
}

function clear_selected_transformation() {
    if (window.selected_transformation !== undefined)
        clear_info_box();
}

/**
 * For a given transformation, show its details pane in the information area.
 * 
 * This pane allows the further interaction with the transformation.
 * 
 * @param {*} trafo     The transformation to display.
 */
function show_transformation_details(trafo) {
    $('#goto-source-btn').hide();

    $('#info-title').text(trafo.transformation);

    const info_contents = $('#info-contents');
    info_contents.html('');

    const trafo_button_container = $('<div>', {
        'class': 'transformation-button-container',
    }).appendTo(info_contents);

    const transformation_info_container = $('<div>', {
        'class': 'transformation-info-container',
    }).appendTo(info_contents);

    //let doc_lines = trafo.docstring.split('\n');
    // TODO: Docstring's formatting goes down the gutter
    // this way. Find a way to pretty print it.
    $('<p>', {
        'class': 'transformation-description-text',
        'text': trafo.docstring,
    }).appendTo(transformation_info_container);

    const trafo_image = $('<object>', {
        'class': 'transformation-image',
        'type': 'image/gif',
    }).appendTo(transformation_info_container);
    trafo_image.attr(
        'data',
        'https://spcl.github.io/dace/transformations/' +
        trafo.transformation + '.gif'
    );

    $('<div>', {
        'class': 'button',
        'click': () => {
            zoom_to_uuids(transformation_get_affected_uuids(trafo));
        },
        'mouseenter': () => {
            highlight_uuids(transformation_get_affected_uuids(trafo));
        },
        'mouseleave': () => {
            if (daceRenderer)
                daceRenderer.draw_async();
        },
    }).append($('<span>', {
        'text': 'Zoom to area',
    })).appendTo(trafo_button_container);

    $('<div>', {
        'class': 'button',
        'click': () => {
            if (vscode)
                vscode.postMessage({
                    type: 'dace.preview_transformation',
                    transformation: trafo,
                });
        },
        'mouseenter': () => {
            highlight_uuids(transformation_get_affected_uuids(trafo));
        },
        'mouseleave': () => {
            if (daceRenderer)
                daceRenderer.draw_async();
        },
    }).append($('<span>', {
        'text': 'Preview',
    })).appendTo(trafo_button_container);

    $('<div>', {
        'class': 'button',
        'click': () => {
            if (vscode) {
                clear_info_box();
                el = document.getElementById('exit-preview-button');
                if (el)
                    el.className = 'button hidden';
                vscode.postMessage({
                    type: 'dace.apply_transformation',
                    transformation: trafo,
                });
            }
        },
        'mouseenter': () => {
            highlight_uuids(transformation_get_affected_uuids(trafo));
        },
        'mouseleave': () => {
            if (daceRenderer)
                daceRenderer.draw_async();
        },
    }).append($('<span>', {
        'text': 'Apply',
    })).appendTo(trafo_button_container);

    generate_attributes_table(undefined, trafo, info_contents);

    $('#info-clear-btn').show();
}