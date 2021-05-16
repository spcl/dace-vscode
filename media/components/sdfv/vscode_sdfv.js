// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

function compute_scope_label(scope_entry) {
    const attributes = scope_entry.data.node.attributes;
    const base_label = attributes.label;

    range_snippets = [];
    for (let i = 0; i < attributes.range.ranges.length; i++) {
        let parameter = '_';
        if (i < attributes.params.length)
            parameter = attributes.params[i];

        let range = attributes.range.ranges[i];
        range_snippets.push(
            parameter + '=' + sdfg_range_elem_to_string(
                range, renderer.view_settings()
            )
        );
    }

    if (range_snippets.length > 0) {
        let label = base_label + '[';
        for (let i = 0; i < range_snippets.length; i++) {
            label += range_snippets[i];
            if (i < range_snippets.length - 1)
                label += ', ';
        }
        label += ']';
        return label;
    } else {
        return base_label;
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
 * @param {*} g  The renderer graph to break down.
 */
function un_graphiphy_sdfg(g) {
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
                un_graphiphy_sdfg(v.attributes.sdfg);
        });
    });
}

function vscode_write_graph(g) {
    un_graphiphy_sdfg(g);
    if (vscode)
        vscode.postMessage({
            type: 'dace.write_edit_to_sdfg',
            sdfg: JSON.stringify(g),
        });
}

function get_element_metadata(elem) {
    let metadata = undefined;
    if (window.sdfg_meta_dict) {
        if (elem.data) {
            if (elem.data.sdfg) {
                metadata = window.sdfg_meta_dict[elem.data.sdfg.type];
            } else if (elem.data.state) {
                metadata = window.sdfg_meta_dict[elem.data.state.type];
            } else if (elem.data.node) {
                const node_type = elem.data.node.type;
                if (elem instanceof ScopeNode) {
                    let node_meta = window.sdfg_meta_dict[node_type];
                    let scope_meta = undefined;
                    let entry_idx = node_type.indexOf('Entry');
                    let exit_idx = node_type.indexOf('Exit');
                    if (entry_idx)
                        scope_meta = window.sdfg_meta_dict[
                            node_type.substring(0, entry_idx)
                        ];
                    else if (exit_idx)
                        scope_meta = window.sdfg_meta_dict[
                            node_type.substring(0, exit_idx)
                        ];

                    metadata = {};
                    if (node_meta !== undefined)
                        Object.keys(node_meta).forEach(k => {
                            metadata[k] = node_meta[k];
                        });
                    if (scope_meta !== undefined)
                        Object.keys(scope_meta).forEach(k => {
                            metadata[k] = scope_meta[k];
                        });
                } else if (node_type === 'LibraryNode') {
                    metadata = window.sdfg_meta_dict[
                        elem.data.node.classpath
                    ];
                } else {
                    metadata = window.sdfg_meta_dict[node_type];
                }
            } else if (elem.data.type) {
                metadata = window.sdfg_meta_dict[elem.data.type];
            }
        } else if (elem.type) {
            metadata = window.sdfg_meta_dict[elem.type];
        }
    } else {
        // If SDFG property metadata isn't available, query it from DaCe.
        vscode.postMessage({
            type: 'dace.query_sdfg_metadata',
        });
        // TODO: This needs to be handled more gracefully.
    }
    return metadata;
}

function attr_table_put_bool(key, subkey, val, elem, target, cell, dtype) {
    const bool_input_container = $('<div>', {
        'class': 'custom-control custom-switch',
    }).appendTo(cell);
    const input = $('<input>', {
        'type': 'checkbox',
        'id': 'switch_' + key,
        'class': 'custom-control-input',
        'checked': val,
    }).appendTo(bool_input_container);
    bool_input_container.append($('<label>', {
        'class': 'custom-control-label',
        'text': ' ',
        'for': 'switch_' + key,
    }));
    return new ValueProperty(elem, target, key, subkey, dtype, input);
}

function attr_table_put_text(key, subkey, val, elem, target, cell, dtype) {
    const input = $('<input>', {
        'type': 'text',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, target, key, subkey, dtype, input);
}

function attr_table_put_number(key, subkey, val, elem, target, cell, dtype) {
    const input = $('<input>', {
        'type': 'number',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, target, key, subkey, dtype, input);
}

function attr_table_put_select(
    key, subkey, val, elem, target, cell, dtype, choices
) {
    const input = $('<select>', {
        'class': 'sdfv-property-dropdown',
    }).appendTo(cell);
    choices.forEach(array => {
        input.append(new Option(
            array,
            array,
            false,
            array === val
        ));
    });
    return new ValueProperty(elem, target, key, subkey, dtype, input);
}

function create_and_show_property_edit_modal(title, with_confirm) {
    const prop_edit_modal = $('<div>', {
        'class': 'modal fade',
        'role': 'dialog',
    }).appendTo('body');

    const modal_document = $('<div>', {
        'class': 'modal-dialog modal-dialog-centered',
        'role': 'document',
    }).appendTo(prop_edit_modal);
    const modal_content = $('<div>', {
        'class': 'modal-content',
    }).appendTo(modal_document);
    const modal_header = $('<div>', {
        'class': 'modal-header',
    }).appendTo(modal_content);

    $('<h5>', {
        'class': 'modal-title',
        'text': title,
    }).appendTo(modal_header);
    $('<button>', {
        'class': 'close',
        'type': 'button',
        'data-dismiss': 'modal',
        'html': '<span>&times;</span>',
    }).appendTo(modal_header);

    const modal_body = $('<div>', {
        'class': 'modal-body property-edit-modal-body',
    }).appendTo(modal_content);

    const modal_footer = $('<div>', {
        'class': 'modal-footer',
    }).appendTo(modal_content);
    $('<button>', {
        'class': 'btn btn-secondary',
        'type': 'button',
        'data-dismiss': 'modal',
        'text': 'Close',
    }).appendTo(modal_footer);

    let modal_confirm_btn = undefined;
    if (with_confirm)
        modal_confirm_btn = $('<button>', {
            'class': 'btn btn-primary',
            'type': 'button',
            'text': 'Ok',
        }).appendTo(modal_footer);

    prop_edit_modal.on('hidden.bs.modal', () => prop_edit_modal.remove());

    return {
        modal: prop_edit_modal,
        body: modal_body,
        confirm_btn: modal_confirm_btn,
    };
}

function attr_table_put_dict(
    key, subkey, val, elem, target, cell, dtype, val_meta
) {
    const dict_cell_container = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfg_property_to_string(val, renderer.view_settings()),
    }).appendTo(dict_cell_container);
    const dict_edit_btn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(dict_cell_container);
    dict_edit_btn.on('click', () => {
        const modal = create_and_show_property_edit_modal(key, true);

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);

        const attribute_properties = [];
        Object.keys(val).forEach(k => {
            let v = val[k];
            const prop = attribute_table_put_entry(
                k, v, val_meta, val, elem, rowbox, true, false
            );

            if (prop)
                attribute_properties.push(prop);
        });

        if (modal.confirm_btn)
            modal.confirm_btn.on('click', () => {
                attribute_properties.forEach(prop => prop.update());
                if (attribute_properties.length)
                    vscode_write_graph(renderer.sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });
}

function attr_table_put_list(
    key, subkey, val, elem, target, cell, dtype, elem_meta
) {
    // If a list's element type is unknown, i.e. there is no element metadata,
    // treat it as a string so it can be edited properly.
    if (elem_meta === undefined)
        elem_meta = {
            metatype: 'str',
        };

    const list_cell_container = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfg_property_to_string(val, renderer.view_settings()),
    }).appendTo(list_cell_container);
    const list_cell_edit_btn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(list_cell_container);
    list_cell_edit_btn.on('click', () => {
        const modal = create_and_show_property_edit_modal(key, true);

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);

        const elements_properties = [];
        if (val)
            for (let i = 0; i < val.length; i++) {
                const v = val[i];
                const prop = attribute_table_put_entry(
                    i, v, elem_meta, val, elem, rowbox, false, false
                );

                if (prop)
                    elements_properties.push(prop);
            }

        if (modal.confirm_btn)
            modal.confirm_btn.on('click', () => {
                elements_properties.forEach(prop => prop.update());
                if (elements_properties.length)
                    vscode_write_graph(renderer.sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });
}

/*
function attr_table_add_dict_input(
    key, val, elem, cell, dtype, val_type, val_meta
) {
    const dict_cell_container = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfg_property_to_string(val, renderer.view_settings()),
    }).appendTo(dict_cell_container);
    const dict_edit_btn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(dict_cell_container);
    dict_edit_btn.on('click', () => {
        const modal = create_and_show_property_edit_modal(key, true);

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);

        const dict_inputs = [];

        if (val)
            Object.keys(val).forEach(k => {
                const val_row = $('<div>', {
                    'class': 'row mb-2',
                }).appendTo(rowbox);
                const dict_input_key = $('<input>', {
                    'type': 'text',
                    'class': 'form-control',
                    'value': k,
                }).appendTo($('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row));
                const dict_input_val = $('<input>', {
                    'type': 'text',
                    'class': 'form-control',
                    'value': val[k] ? val[k] : '',
                }).appendTo($('<div>', {
                    'class': 'col-9',
                }).appendTo(val_row));
                dict_inputs.push({
                    key: dict_input_key,
                    val: dict_input_val,
                });
            });

        const add_item_container = $('<div>', {
            'class': 'container_fluid',
        }).appendTo(modal.body);
        const add_item_button_row = $('<div>', {
            'class': 'row',
        }).appendTo(add_item_container);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                const val_row = $('<div>', {
                    'class': 'row mb-2',
                }).appendTo(rowbox);
                const dict_input_key = $('<input>', {
                    'type': 'text',
                    'class': 'form-control',
                    'value': '',
                }).appendTo($('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row));
                const dict_input_val = $('<input>', {
                    'type': 'text',
                    'class': 'form-control',
                    'value': '',
                }).appendTo($('<div>', {
                    'class': 'col-9',
                }).appendTo(val_row));
                dict_inputs.push({
                    key: dict_input_key,
                    val: dict_input_val,
                });
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(add_item_button_row));

        const prop = new DictProperty(elem, key, undefined, dtype, dict_inputs);
        if (modal.confirm_btn)
            modal.confirm_btn.on('click', () => {
                prop.update();
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });
}
*/

function attr_table_add_list_input(key, val, elem, cell, dtype) {
    const list_cell_container = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfg_property_to_string(val, renderer.view_settings()),
    }).appendTo(list_cell_container);
    const list_cell_edit_btn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(list_cell_container);
    list_cell_edit_btn.on('click', () => {
        const modal = create_and_show_property_edit_modal(key, true);

        const rowbox = $('<div>', {
            'class': 'container_fluid',
        }).appendTo(modal.body);

        const list_inputs = [];

        if (val)
            val.forEach(v => {
                const val_row = $('<div>', {
                    'class': 'row mb-2',
                }).appendTo(rowbox);
                list_inputs.push($('<input>', {
                    'type': 'text',
                    'class': 'form-control',
                    'value': v ? v : '',
                }).appendTo($('<div>', {
                    'class': 'col-12',
                }).appendTo(val_row)));
            });

        const add_item_container = $('<div>', {
            'class': 'container_fluid',
        }).appendTo(modal.body);
        const add_item_button_row = $('<div>', {
            'class': 'row',
        }).appendTo(add_item_container);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                const val_row = $('<div>', {
                    'class': 'row mb-2',
                }).appendTo(rowbox);
                list_inputs.push($('<input>', {
                    'type': 'text',
                    'class': 'form-control',
                    'value': '',
                }).appendTo($('<div>', {
                    'class': 'col-12',
                }).appendTo(val_row)));
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(add_item_button_row));

        const prop = new ListProperty(elem, key, undefined, dtype, list_inputs);

        if (modal.confirm_btn)
            modal.confirm_btn.on('click', () => {
                prop.update();
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

}

function attr_table_add_range_input(key, val, elem, cell, dtype) {
    const range_cell_container = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<td>', {
        'html': sdfg_property_to_string(val, renderer.view_settings()),
    }).appendTo(range_cell_container);
    const range_edit_btn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(range_cell_container);
    range_edit_btn.on('click', () => {
        const modal = create_and_show_property_edit_modal(key, true);

        const rowbox = $('<div>', {
            'class': 'container_fluid',
        }).appendTo(modal.body);

        let ranges_inputs = [];
        if (val)
            val.ranges.forEach(range => {
                const val_row = $('<div>', {
                    'class': 'row',
                }).appendTo(rowbox);

                const range_start_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': range.start,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Start:',
                })).append(range_start_input);

                const range_end_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': range.end,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'End:',
                })).append(range_end_input);

                const range_step_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': range.step,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Step:',
                })).append(range_step_input);

                const range_tile_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': range.tile,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Tile:',
                })).append(range_tile_input);

                ranges_inputs.push({
                    start: range_start_input,
                    end: range_end_input,
                    step: range_step_input,
                    tile: range_tile_input,
                });
            });

        const add_item_container = $('<div>', {
            'class': 'container_fluid',
        }).appendTo(modal.body);
        const add_item_button_row = $('<div>', {
            'class': 'row',
        }).appendTo(add_item_container);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                const val_row = $('<div>', {
                    'class': 'row',
                }).appendTo(rowbox);

                const range_start_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Start:',
                })).append(range_start_input);

                const range_end_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'End:',
                })).append(range_end_input);

                const range_step_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Step:',
                })).append(range_step_input);

                const range_tile_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(val_row).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Tile:',
                })).append(range_tile_input);

                ranges_inputs.push({
                    start: range_start_input,
                    end: range_end_input,
                    step: range_step_input,
                    tile: range_tile_input,
                });
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(add_item_button_row));

        const prop = new RangeProperty(elem, key, 'ranges', dtype, ranges_inputs);

        if (modal.confirm_btn)
            modal.confirm_btn.on('click', () => {
                prop.update();
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });
}

function attribute_table_put_entry(
    key, val, meta, target, elem, root, editable_key, update_on_change
) {
    let prop = undefined;

    let dtype = undefined;
    let choices = undefined;
    if (meta) {
        if (meta['metatype'])
            dtype = meta['metatype'];
        if (meta['choices'])
            choices = meta['choices'];
    }

    const row = $('<div>', {
        'class': 'row info-table-row',
    }).appendTo(root);
    if (editable_key) {
        const key_cell = $('<div>', {
            'class': 'col-3 info-table-cell',
        }).appendTo(row);
        const key_input = $('<input>', {
            'type': 'text',
            'class': 'property-key-input',
            'value': key,
        }).appendTo(key_cell);
        key_input.on('change', () => {
            const new_key = key_input.val();
            if (new_key !== key) {
                Object.defineProperty(
                    target,
                    new_key,
                    Object.getOwnPropertyDescriptor(target, key)
                );
                delete target[key];

                vscode_write_graph(renderer.sdfg);
            }
        });
    } else {
        $('<div>', {
            'class': 'col-3 info-table-heading info-table-cell',
            'text': key,
        }).appendTo(row);
    }
    const value_cell = $('<div>', {
        'class': 'col-9 info-table-cell',
    }).appendTo(row);

    if (dtype === undefined) {
        value_cell.html(sdfg_property_to_string(val, renderer.view_settings()));
    } else {
        switch (dtype) {
            case 'bool':
                prop = attr_table_put_bool(
                    key, undefined, val, elem, target, value_cell, dtype, false
                );
                break;
            case 'str':
            case 'LambdaProperty':
            case 'SymbolicProperty':
                // TODO(later): Treat symbolic expressions with a symbolic
                // parser, they're not just a regular string.
                prop = attr_table_put_text(
                    key, undefined, val, elem, target, value_cell, dtype
                );
                break;
            case 'int':
                prop = attr_table_put_number(
                    key, undefined, val, elem, target, value_cell, dtype
                );
                break;
            case 'dict':
                let val_type = undefined;
                let val_meta = undefined;
                if (meta !== undefined && meta['value_type'])
                    val_type = meta['value_type'];
                if (window.sdfg_meta_dict && val_type &&
                    window.sdfg_meta_dict['__reverse_type_lookup__'] &&
                    window.sdfg_meta_dict['__reverse_type_lookup__'][val_type])
                    val_meta = window.sdfg_meta_dict[
                        '__reverse_type_lookup__'
                    ][val_type];
                attr_table_put_dict(
                    key, undefined, val, elem, target, value_cell, dtype,
                    val_meta
                );
                break;
            case 'set':
            case 'list':
            case 'tuple':
                let elem_type = undefined;
                let elem_meta = undefined;
                if (meta !== undefined && meta['element_type'])
                    elem_type = meta['element_type'];
                if (window.sdfg_meta_dict && elem_type &&
                    window.sdfg_meta_dict['__reverse_type_lookup__'] &&
                    window.sdfg_meta_dict['__reverse_type_lookup__'][elem_type])
                    elem_meta = window.sdfg_meta_dict[
                        '__reverse_type_lookup__'
                    ][elem_type];
                attr_table_put_list(
                    key, undefined, val, elem, target, value_cell, dtype,
                    elem_meta
                );
                break;
            case 'Range':
            case 'SubsetProperty':
                attr_table_add_range_input(key, val, target, value_cell, dtype);
                break;
            case 'DataProperty':
                prop = attr_table_put_select(
                    key, undefined, val, elem, target, value_cell, dtype,
                    Object.keys(elem.sdfg.attributes._arrays)
                );
                break;
            case 'CodeBlock':
                prop = attr_table_put_text(
                    key, 'string_data', val ? val.string_data : '', elem,
                    target, value_cell, dtype
                );
                break;
            default:
                if (choices !== undefined)
                    prop = attr_table_put_select(
                        key, undefined, val, elem, target, value_cell, dtype,
                        choices
                    );
                else
                    value_cell.html(sdfg_property_to_string(
                        val, renderer.view_settings()
                    ));
                break;
        }
    }

    if (update_on_change && prop !== undefined && prop.input !== undefined)
        prop.input.on('change', () => {
            prop.update();
            vscode_write_graph(renderer.sdfg);
        });

    return prop;
}

function generate_attributes_table(elem, root) {
    let attributes = undefined;
    if (elem.data) {
        if (elem.data.attributes)
            attributes = elem.data.attributes;
        else if (elem.data.node)
            attributes = elem.data.node.attributes;
        else if (elem.data.state)
            attributes = elem.data.state.attributes;
    } else {
        attributes = elem.attributes;
    }

    const attr_table = $('<div>', {
        'class': 'container-fluid info-table',
    }).appendTo(root);
    const attr_table_header_row = $('<div>', {
        'class': 'row info-table-row',
    }).appendTo(attr_table);
    $('<div>', {
        'class': 'col-3 info-table-heading',
        'text': 'Attribute',
    }).appendTo(attr_table_header_row);
    $('<div>', {
        'class': 'col-9 info-table-heading',
        'text': 'Value',
    }).appendTo(attr_table_header_row);

    let metadata = get_element_metadata(elem);

    Object.keys(attributes).forEach(k => {
        const val = attributes[k];
        if (k === 'layout' || k === 'sdfg' ||
            k === 'is_collapsed' || k === 'orig_sdfg' ||
            k === 'transformation_hist' || k.startsWith('_'))
            return;

        // Debug info isn't printed in the attributes table, but instead we
        // show a button to jump to the referenced code location.
        if (k === 'debuginfo') {
            if (val) {
                const gotoSourceBtn = $('#goto-source-btn');
                gotoSourceBtn.on('click', function() {
                    gotoSource(
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

        let attr_meta = undefined;
        if (metadata && metadata[k])
            attr_meta = metadata[k];

        attribute_table_put_entry(
            k, val, attr_meta, attributes, elem, root, false, true
        );
    });
}