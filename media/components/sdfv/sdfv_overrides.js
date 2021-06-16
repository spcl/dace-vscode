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

        generate_attributes_table(elem, undefined, contents);

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

            generate_attributes_table(sdfg_array, undefined, contents);
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
                const ret_other_elem = daceFindGraphElementByUUID(
                    daceRenderer.graph,
                    other_uuid
                );
                other_element = ret_other_elem.element;
            }

            if (other_element) {
                $('<br>').appendTo(contents);
                $('<p>', {
                    'class': 'info-subtitle',
                    'text': other_element.type() + ' ' + other_element.label(),
                }).appendTo(contents);

                generate_attributes_table(other_element, undefined, contents);
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
        'uuid': daceGetUUIDGraphElement(undefined),
        'children': [],
    };
    outline_list.push(top_level_sdfg);

    const stack = [top_level_sdfg];

    daceTraverseSDFGScopes(graph, (node, parent) => {
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
            'uuid': daceGetUUIDGraphElement(node),
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
if (daceUIHandlers === undefined)
    console.error("DaCe UI Handlers are not defined");

daceUIHandlers.on_init_menu = init_info_box;
daceUIHandlers.on_sidebar_set_title = info_box_set_title;
daceUIHandlers.on_sidebar_show = info_box_show;
daceUIHandlers.on_sidebar_get_contents = info_box_get_contents;
daceUIHandlers.on_close_menu = clear_info_box;
daceUIHandlers.on_outline = embedded_outline;
// Redefine the standard SDFV element information-display function with the one
// for the embedded layout.
daceUIHandlers.on_fill_info = fill_info_embedded;
