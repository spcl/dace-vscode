// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

/**
 * Set the header/title of the info-box in the embedded view.
 * @param {*} title Title to set
 */
function info_box_set_title(title) {
    $('#info-title').text(title);
}

/**
 * Get the current info-box contents.
 */
function info_box_get_contents() {
    return document.getElementById('info-contents');
}

/**
 * Show the info box and its necessary components.
 */
function info_box_show() {
    $('#info-clear-btn').show();
}

/**
 * Clear the info container and its title.
 * This also hides the clear button again.
 */
function clear_info_box() {
    $('#info-contents').html('');
    $('#info-title').text('');
    $('#info-clear-btn').hide();
    $('#goto-source-btn').hide();
    window.selected_transformation = undefined;
    if (vscode)
        vscode.postMessage({
            'type': 'transformation_list.deselect',
        });
}

/**
 * Fill out the info-box of the embedded layout with info about an element.
 * This dynamically builds one or more tables showing all of the relevant info
 * about a given element.
 * @param {*} elem  The element to display info about
 */
function fill_info_embedded(elem) {
    const gotoSourceBtn = $('#goto-source-btn');
    // Clear and hide the go to source button.
    gotoSourceBtn.hide();
    gotoSourceBtn.off('click');
    gotoSourceBtn.prop('title', '');

    if (elem) {
        document.getElementById('info-title').innerText =
            elem.type() + ' ' + elem.label();

        const contents = $('#info-contents');
        contents.html('');
        if (elem instanceof Edge && elem.data.type === 'Memlet') {
            let sdfg_edge = elem.sdfg.nodes[elem.parent_id].edges[elem.id];
            $('<p>', {
                'class': 'info-subtitle',
                'html': 'Connectors: ' + sdfg_edge.src_connector +
                    ' <i class="material-icons">arrow_forward</i> ' +
                    sdfg_edge.dst_connector,
            }).appendTo(contents);
            $('<hr>').appendTo(contents);
        }

        const attr_table = $('<table>', {
            id: 'sdfg-attribute-table',
            'class': 'info-table',
        }).appendTo(contents);
        const attr_table_header = $('<thead>').appendTo(attr_table);
        const attr_table_header_row = $('<tr>').appendTo(attr_table_header);
        $('<th>', {
            'class': 'key-col',
            'text': 'Attribute',
        }).appendTo(attr_table_header_row);
        $('<th>', {
            'class': 'val-col',
            'text': 'Value',
        }).appendTo(attr_table_header_row);

        const attr_table_body = $('<tbody>').appendTo(attr_table);
        for (const attr of Object.entries(elem.attributes())) {
            if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                attr[0] === 'orig_sdfg' || attr[0] === 'transformation_hist' ||
                attr[0].startsWith('_'))
                continue;
            const val = sdfg_property_to_string(
                attr[1],
                renderer.view_settings()
            );
            if (val === null || val === '')
                continue;


            if (attr[0] === 'instrument') {
                if (window.instruments) {
                    const row = $('<tr>').appendTo(attr_table_body);
                    $('<th>', {
                        'class': 'key-col',
                        'text': attr[0],
                    }).appendTo(row);
                    const cell = $('<td>', {
                        'class': 'val-col',
                    }).appendTo(row);

                    const select = $('<select>', {
                        'name': 'instrument',
                        'class': 'sdfv-property-dropdown',
                    }).appendTo(cell);

                    select.change(() => {
                        if (elem && elem.data) {
                            if (elem.data.attributes)
                                elem.data.attributes.instrument = select.val();
                            else if (elem.data.state)
                                elem.data.state.attributes.instrument =
                                    select.val();
                            else if (elem.data.node)
                                elem.data.node.attributes.instrument =
                                    select.val();

                            let g = renderer.sdfg;

                            // The renderer uses a graph representation with
                            // additional information, and to make sure that
                            // the classical SDFG representation and that graph
                            // representation are kept in sync, the SDFG object
                            // is made cyclical. We use this to break the
                            // renderer's SDFG representation back down into the
                            // classical one, removing layout information along
                            // with it.
                            function unGraphifySdfg(g) {
                                g.edges.forEach((e) => {
                                    if (e.attributes.data.edge)
                                        delete e.attributes.data.edge;
                                });

                                g.nodes.forEach((s) => {
                                    if (s.attributes.layout)
                                        delete s.attributes.layout;

                                    s.edges.forEach((e) => {
                                        if (e.attributes.data.edge)
                                            delete e.attributes.data.edge;
                                    });

                                    s.nodes.forEach((v) => {
                                        if (v.attributes.layout)
                                            delete v.attributes.layout;

                                        if (v.type === 'NestedSDFG')
                                            unGraphifySdfg(v.attributes.sdfg);
                                    });
                                });
                            }

                            unGraphifySdfg(g);

                            vscode.postMessage({
                                type: 'dace.write_edit_to_sdfg',
                                sdfg: JSON.stringify(g),
                            });
                        }
                    });

                    window.instruments.forEach(el => {
                        select.append(new Option(
                            el,
                            el,
                            false,
                            el === attr[1]
                        ));
                    });
                } else {
                    // If the available instruments aren't set yet, try to
                    // get them from DaCe.
                    vscode.postMessage({
                        type: 'dace.get_enum',
                        name: 'InstrumentationType',
                    });
                }
            } else {
                if (attr[0] === 'debuginfo') {
                    gotoSourceBtn.on('click', function() {
                        gotoSource(
                            attr[1].filename,
                            attr[1].start_line,
                            attr[1].start_column,
                            attr[1].end_line,
                            attr[1].end_column
                        );
                    });
                    gotoSourceBtn.prop('title',
                        attr[1].filename + ':' + attr[1].start_line);
                    gotoSourceBtn.show();
                    continue;
                }

                const row = $('<tr>').appendTo(attr_table_body);
                $('<th>', {
                    'class': 'key-col',
                    'text': attr[0],
                }).appendTo(row);
                $('<td>', {
                    'class': 'val-col',
                    'html': val,
                }).appendTo(row);
            }
        }

        // If we're processing an access node, add array information too
        if (elem instanceof AccessNode) {
            const sdfg_array = elem.sdfg.attributes._arrays[
                elem.attributes().data
            ];
            $('<br>').appendTo(contents);
            $('<p>', {
                'class': 'info-subtitle',
                'text': 'Array properties:',
            }).appendTo(contents);

            const array_table = $('<table>', {
                id: 'sdfg-array-table',
                'class': 'info-table',
            }).appendTo(contents);
            const array_table_header = $('<thead>').appendTo(array_table);
            const array_table_header_row =
                $('<tr>').appendTo(array_table_header);
            $('<th>', {
                'class': 'key-col',
                'text': 'Property',
            }).appendTo(array_table_header_row);
            $('<th>', {
                'class': 'val-col',
                'text': 'Value',
            }).appendTo(array_table_header_row);

            const array_table_body = $('<tbody>').appendTo(array_table);
            for (const attr of Object.entries(sdfg_array.attributes)) {
                if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                    attr[0].startsWith('_meta_'))
                    continue;
                const val = sdfg_property_to_string(
                    attr[1],
                    renderer.view_settings()
                );
                if (val === null || val === '')
                    continue;
                const row = $('<tr>').appendTo(array_table_body);
                $('<th>', {
                    'class': 'key-col',
                    'text': attr[0],
                }).appendTo(row);
                $('<td>', {
                    'class': 'val-col',
                    'html': val,
                }).appendTo(row);
            }
        }

        $('#info-clear-btn').show();
    } else {
        clear_info_box();
    }
}

function embedded_outline(renderer, graph) {
    if (vscode === undefined)
        return;

    const outline_list = [];

    const top_level_sdfg = {
        'icon': 'res:icon-theme/sdfg.svg',
        'type': 'SDFG',
        'label': `SDFG ${renderer.sdfg.attributes.name}`,
        'collapsed': false,
        'uuid': get_uuid_graph_element(undefined),
        'children': [],
    };
    outline_list.push(top_level_sdfg);

    const stack = [top_level_sdfg];

    traverse_sdfg_scopes(graph, (node, parent) => {
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
            const state = node.sdfg.nodes[node.parent_id];
            if (state.scope_dict[node.id] !== undefined)
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
    }, (node, parent) => {
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

function init_info_box() {
    // Pass
}

// Redefine the standard SDFV sidebar interface with the one for the info-box.
init_menu = init_info_box;
sidebar_set_title = info_box_set_title;
sidebar_show = info_box_show;
sidebar_get_contents = info_box_get_contents;
close_menu = clear_info_box;
outline = embedded_outline;
// Redefine the standard SDFV element information-display function with the one
// for the embedded layout.
fill_info = fill_info_embedded;
