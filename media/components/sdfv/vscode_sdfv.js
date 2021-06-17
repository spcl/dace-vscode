// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

function vscode_handle_event(event, data) {
    switch (event) {
        case 'on_renderer_selection_changed':
            if (daceRenderer && daceRenderer.selected_elements.length > 1)
                get_applicable_transformations();
            else
                sort_transformations(refresh_transformation_list);
            break;
    }
}

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
            parameter + '=' + daceSDFGRangeElemToString(
                range, daceRenderer.view_settings()
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

function element_update_label(element, attributes) {
    if (element.data && attributes.label) {
        if (element.data.node) {
            element.data.node.label = attributes.label;

            if (element instanceof ScopeNode) {
                // In scope nodes the range is attached.
                if (element instanceof EntryNode) {
                    let exit_elem = daceFindGraphElementByUUID(
                        daceRenderer.graph,
                        element.sdfg.sdfg_list_id + '/' +
                        element.parent_id + '/' +
                        element.data.node.scope_exit + '/-1'
                    );
                    if (exit_elem) {
                        element.data.node.label = compute_scope_label(element);
                        exit_elem.element.data.node.label =
                            element.data.node.label;
                    }
                } else if (element instanceof ExitNode) {
                    let entry_elem = daceFindGraphElementByUUID(
                        daceRenderer.graph,
                        element.sdfg.sdfg_list_id + '/' +
                        element.parent_id + '/' +
                        element.data.node.scope_entry + '/-1'
                    );
                    if (entry_elem) {
                        element.data.node.label =
                            compute_scope_label(entry_elem.element);
                        entry_elem.element.data.node.label =
                            element.data.node.label;
                    }
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

function reselect_renderer_element(elem) {
    if (daceRenderer && daceRenderer.graph) {
        const uuid = daceGetUUIDGraphElement(elem);
        const new_elem_res = daceFindGraphElementByUUID(
            daceRenderer.graph, uuid
        );
        if (new_elem_res && new_elem_res.element) {
            const new_elem = new_elem_res.element;
            fill_info_embedded(new_elem);
        }
    }
}

function get_transformation_metadata(transformation) {
    let metadata = undefined;
    if (window.sdfg_meta_dict) {
        if (transformation.transformation)
            metadata = window.sdfg_meta_dict[transformation.transformation];
    } else {
        // If SDFG property metadata isn't available, query it from DaCe.
        vscode.postMessage({
            type: 'dace.query_sdfg_metadata',
        });
    }
    return metadata;
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
    }
    return metadata;
}

function attr_table_put_bool(
    key, subkey, val, elem, xform, target, cell, dtype
) {
    const bool_input_container = $('<div>', {
        'class': 'form-check form-switch',
    }).appendTo(cell);
    const input = $('<input>', {
        'type': 'checkbox',
        'id': 'switch_' + key,
        'class': 'form-check-input',
        'checked': val,
    }).appendTo(bool_input_container);
    bool_input_container.append($('<label>', {
        'class': 'form-check-label',
        'text': ' ',
        'for': 'switch_' + key,
    }));
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

function attr_table_put_text(
    key, subkey, val, elem, xform, target, cell, dtype
) {
    const input = $('<input>', {
        'type': 'text',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

function attr_table_put_code(
    key, subkey, val, elem, xform, target, cell, dtype
) {
    const input = $('<textarea>', {
        'class': 'sdfv-property-code',
        'wrap': 'soft',
        'rows': 3,
        'cols': 81,
        'text': val,
    }).appendTo(cell);
    /*
    //TODO: Switch to monaco editor.
    const input = $('<div>', {
        width: '300px',
        height: '50px',
    }).appendTo(cell);
    window.monaco.editor.create(input.get(0), {
        value: val,
        language: "python",
        theme: 'vs-dark',
    });
    */
    const languages = window.sdfg_meta_dict['__reverse_type_lookup__'][
        'Language'
    ].choices;
    const language_input = $('<select>', {
        'class': 'sdfv-property-dropdown',
    }).appendTo(cell);
    languages.forEach(lang => {
        language_input.append(new Option(
            lang,
            lang,
            false,
            lang === target[key]['language']
        ));
    });
    return new CodeProperty(
        elem, xform, target, key, subkey, dtype, input, language_input
    );
}

function attr_table_put_number(
    key, subkey, val, elem, xform, target, cell, dtype
) {
    const input = $('<input>', {
        'type': 'number',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

function attr_table_put_select(
    key, subkey, val, elem, xform, target, cell, dtype, choices
) {
    const input = $('<select>', {
        'class': 'sdfv-property-dropdown',
    }).appendTo(cell);
    if (!choices.includes(val))
        input.append(new Option(
            val,
            val,
            false,
            true
        ));
    choices.forEach(array => {
        input.append(new Option(
            array,
            array,
            false,
            array === val
        ));
    });

    if (elem && elem instanceof LibraryNode && key === 'implementation')
        $('<button>', {
            'class': 'btn btn-sm btn-primary sdfv-property-expand-libnode-btn',
            'text': 'Expand',
            'click': () => {
                if (vscode)
                    vscode.postMessage({
                        type: 'dace.expand_library_node',
                        nodeid: [
                            elem.sdfg.sdfg_list_id,
                            elem.parent_id,
                            elem.id,
                        ],
                    });
            },
        }).appendTo(cell);

    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

function attr_table_put_typeclass(
    key, subkey, val, elem, xform, target, cell, dtype, choices
) {
    const container = $('<div>', {
        'style': 'position: relative;',
    }).appendTo(cell);
    const input = $('<input>', {
        'list': key + '-native-typeclasses',
        'value': daceSDFGTypeclassToString(val),
    }).appendTo(container);
    if (choices) {
        const datalist = $('<datalist>', {
            'id': key + '-native-typeclasses',
        }).appendTo(container);
        choices.forEach(array => {
            datalist.append(new Option(
                array,
                array,
                false,
                false
            ));
        });
    }
    return new TypeclassProperty(
        elem, xform, target, key, subkey, dtype, input
    );
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

    const modal_body = $('<div>', {
        'class': 'modal-body property-edit-modal-body',
    }).appendTo(modal_content);

    const modal_footer = $('<div>', {
        'class': 'modal-footer',
    }).appendTo(modal_content);
    $('<button>', {
        'class': 'btn btn-secondary',
        'type': 'button',
        'data-bs-dismiss': 'modal',
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
    key, subkey, val, elem, xform, target, cell, dtype, val_meta
) {
    const dict_cell_container = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': daceSDFGPropertyToString(val, daceRenderer.view_settings()),
    }).appendTo(dict_cell_container);
    const dict_edit_btn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(dict_cell_container);

    const prop = new DictProperty(elem, xform, target, key, subkey, dtype, []);

    dict_edit_btn.on('click', () => {
        prop.properties = [];

        const modal = create_and_show_property_edit_modal(key, true);

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        Object.keys(val).forEach(k => {
            let v = val[k];
            const attr_prop = attribute_table_put_entry(
                k, v, val_meta, val, elem, xform, rowbox, true, false, true
            );

            if (attr_prop.delete_btn)
                attr_prop.delete_btn.on('click', () => {
                    attr_prop.key_prop.input.val('');
                    attr_prop.row.hide();
                });

            if (attr_prop)
                prop.properties.push(attr_prop);
        });

        const add_item_container = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const add_item_button_row = $('<div>', {
            'class': 'row',
        }).appendTo(add_item_container);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                let new_prop = undefined;
                if (val_meta)
                    new_prop = attribute_table_put_entry(
                        '', '', val_meta, val, elem, xform, rowbox, true, false,
                        true
                    );
                else
                    new_prop = attribute_table_put_entry(
                        '', '', { metatype: 'str' }, val, elem, xform, rowbox,
                        true, false, true
                    );
                if (new_prop) {
                    prop.properties.push(new_prop);

                    if (new_prop.delete_btn)
                        new_prop.delete_btn.on('click', () => {
                            new_prop.key_prop.input.val('');
                            new_prop.row.hide();
                        });
                }
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(add_item_button_row));

        if (modal.confirm_btn)
            modal.confirm_btn.on('click', () => {
                if (prop.update() && !xform)
                    vscode_write_graph(daceRenderer.sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

function attr_table_put_list(
    key, subkey, val, elem, xform, target, cell, dtype, elem_meta
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
        'html': daceSDFGPropertyToString(val, daceRenderer.view_settings()),
    }).appendTo(list_cell_container);
    const list_cell_edit_btn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(list_cell_container);

    const prop = new ListProperty(elem, xform, target, key, subkey, dtype, []);

    list_cell_edit_btn.on('click', () => {
        prop.properties_list = [];

        const modal = create_and_show_property_edit_modal(key, true);

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        if (val)
            for (let i = 0; i < val.length; i++) {
                const v = val[i];
                const attr_prop = attribute_table_put_entry(
                    i, v, elem_meta, val, elem, xform, rowbox, false, false,
                    true
                );

                if (attr_prop.delete_btn) {
                    attr_prop.delete_btn.on('click', () => {
                        if (attr_prop.val_prop.input) {
                            attr_prop.val_prop.input.val('');
                            attr_prop.row.hide();
                        }
                    });
                }

                if (attr_prop && attr_prop.val_prop)
                    prop.properties_list.push(attr_prop.val_prop);
            }

        const add_item_container = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const add_item_button_row = $('<div>', {
            'class': 'row',
        }).appendTo(add_item_container);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                let i = prop.properties_list.length;
                let new_prop = attribute_table_put_entry(
                    i, '', elem_meta, val, elem, xform, rowbox, false, false,
                    true
                );
                if (new_prop && new_prop.val_prop) {
                    prop.properties_list.push(new_prop.val_prop);

                    if (new_prop.delete_btn) {
                        new_prop.delete_btn.on('click', () => {
                            if (new_prop.val_prop.input) {
                                new_prop.val_prop.input.val('');
                                new_prop.row.hide();
                            }
                        });
                    }
                }
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(add_item_button_row));

        if (modal.confirm_btn)
            modal.confirm_btn.on('click', () => {
                if (prop.update() && !xform)
                    vscode_write_graph(daceRenderer.sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

function attr_table_put_range(
    key, subkey, val, elem, xform, target, cell, dtype
) {
    const range_cell_container = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<td>', {
        'html': daceSDFGPropertyToString(val, daceRenderer.view_settings()),
    }).appendTo(range_cell_container);
    const range_edit_btn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(range_cell_container);

    const prop = new RangeProperty(
        elem, xform, target, key, 'ranges', dtype, []
    );

    range_edit_btn.on('click', () => {
        prop.range_input_list = [];

        const modal = create_and_show_property_edit_modal(key, true);

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        if (val && val.ranges)
            val.ranges.forEach(range => {
                const val_row = $('<div>', {
                    'class': 'row',
                }).appendTo(rowbox);

                const range_start_input = $('<input>', {
                    'type': 'text',
                    'class': 'range-input',
                    'value': range.start,
                });
                const range_start_container = $('<div>', {
                    'class': 'col-3 sdfv-property-range-delete-cell',
                }).appendTo(val_row);
                const delete_btn = $('<span>', {
                    'class': 'material-icons-outlined sdfv-property-delete-btn',
                    'text': 'remove_circle',
                    'title': 'Delete entry',
                }).appendTo(range_start_container);
                range_start_container.append($('<div>').append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Start:',
                })).append(range_start_input));

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

                delete_btn.on('click', () => {
                    range_start_input.val('');
                    range_end_input.val('');
                    range_step_input.val('');
                    range_tile_input.val('');
                    val_row.hide();
                });

                prop.range_input_list.push({
                    start: range_start_input,
                    end: range_end_input,
                    step: range_step_input,
                    tile: range_tile_input,
                });
            });

        const add_item_container = $('<div>', {
            'class': 'container-fluid',
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
                const range_start_container = $('<div>', {
                    'class': 'col-3 sdfv-property-range-delete-cell',
                }).appendTo(val_row);
                const delete_btn = $('<span>', {
                    'class': 'material-icons-outlined sdfv-property-delete-btn',
                    'text': 'remove_circle',
                    'title': 'Delete entry',
                }).appendTo(range_start_container);
                range_start_container.append($('<div>').append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Start:',
                })).append(range_start_input));

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

                delete_btn.on('click', () => {
                    range_start_input.val('');
                    range_end_input.val('');
                    range_step_input.val('');
                    range_tile_input.val('');
                    val_row.hide();
                });

                prop.range_input_list.push({
                    start: range_start_input,
                    end: range_end_input,
                    step: range_step_input,
                    tile: range_tile_input,
                });
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(add_item_button_row));

        if (modal.confirm_btn)
            modal.confirm_btn.on('click', () => {
                if (prop.update() && !xform)
                    vscode_write_graph(daceRenderer.sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

function attribute_table_put_entry(
    key, val, meta, target, elem, xform, root, editable_key, update_on_change,
    add_delete_button
) {
    let key_prop = undefined;
    let val_prop = undefined;
    let delete_btn = undefined;

    let dtype = undefined;
    let choices = undefined;
    if (meta) {
        if (meta['metatype'])
            dtype = meta['metatype'];
        if (meta['choices'])
            choices = meta['choices'];
    }

    const row = $('<div>', {
        'class': 'row attr-table-row',
    }).appendTo(root);
    let key_cell = undefined;
    if (editable_key) {
        key_cell = $('<div>', {
            'class': 'col-3 attr-table-cell',
        }).appendTo(row);
        const key_input = $('<input>', {
            'type': 'text',
            'class': 'property-key-input',
            'value': key,
        }).appendTo(key_cell);

        key_prop = new KeyProperty(elem, xform, target, key, key_input);
    } else {
        key_cell = $('<div>', {
            'class': 'col-3 attr-table-heading attr-table-cell',
            'text': key,
        }).appendTo(row);
    }

    if (add_delete_button) {
        key_cell.addClass('attr-table-cell-nopad');
        delete_btn = $('<span>', {
            'class': 'material-icons-outlined sdfv-property-delete-btn',
            'text': 'remove_circle',
            'title': 'Delete entry',
        }).prependTo(key_cell);
    }

    const value_cell = $('<div>', {
        'class': 'col-9 attr-table-cell',
    }).appendTo(row);

    if (dtype === undefined) {
        value_cell.html(daceSDFGPropertyToString(
            val, daceRenderer.view_settings()
        ));
    } else {
        switch (dtype) {
            case 'typeclass':
                val_prop = attr_table_put_typeclass(
                    key, undefined, val, elem, xform, target, value_cell, dtype,
                    choices
                );
                break;
            case 'bool':
                val_prop = attr_table_put_bool(
                    key, undefined, val, elem, xform, target, value_cell, dtype,
                    false
                );
                break;
            case 'str':
            case 'LambdaProperty':
            case 'SymbolicProperty':
                // TODO(later): Treat symbolic expressions with a symbolic
                // parser, they're not just a regular string.
                val_prop = attr_table_put_text(
                    key, undefined, val, elem, xform, target, value_cell, dtype
                );
                break;
            case 'int':
                val_prop = attr_table_put_number(
                    key, undefined, val, elem, xform, target, value_cell, dtype
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
                    key, undefined, val, elem, xform, target, value_cell, dtype,
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
                val_prop = attr_table_put_list(
                    key, undefined, val, elem, xform, target, value_cell, dtype,
                    elem_meta
                );
                break;
            case 'Range':
            case 'SubsetProperty':
                val_prop = attr_table_put_range(
                    key, undefined, val, elem, xform, target, value_cell, dtype
                );
                break;
            case 'DataProperty':
                val_prop = attr_table_put_select(
                    key, undefined, val, elem, xform, target, value_cell, dtype,
                    elem ? Object.keys(elem.sdfg.attributes._arrays): []
                );
                break;
            case 'CodeBlock':
                val_prop = attr_table_put_code(
                    key, undefined, val ? val.string_data : '', elem, xform,
                    target, value_cell, dtype
                );
                break;
            default:
                if (choices !== undefined)
                    val_prop = attr_table_put_select(
                        key, undefined, val, elem, xform, target, value_cell,
                        dtype, choices
                    );
                else
                    value_cell.html(daceSDFGPropertyToString(
                        val, daceRenderer.view_settings()
                    ));
                break;
        }
    }

    if (update_on_change && val_prop !== undefined) {
        if (val_prop.input !== undefined) {
            val_prop.input.on('change', () => {
                val_prop.update();
                if (!xform)
                    vscode_write_graph(daceRenderer.sdfg);
            });
        } else if (val_prop.code_input !== undefined &&
                   val_prop.lang_input !== undefined) {
            val_prop.code_input.on('change', () => {
                val_prop.update();
                if (!xform)
                    vscode_write_graph(daceRenderer.sdfg);
            });
            val_prop.lang_input.on('change', () => {
                val_prop.update();
                if (!xform)
                    vscode_write_graph(daceRenderer.sdfg);
            });
        }
    }

    if (update_on_change && key_prop !== undefined &&
        key_prop.input !== undefined)
        key_prop.input.on('change', () => {
            if (key_prop.update() && !xform)
                vscode_write_graph(daceRenderer.sdfg);
        });

    return {
        key_prop: key_prop,
        val_prop: val_prop,
        delete_btn: delete_btn,
        row: row,
    };
}

function generate_attributes_table(elem, xform, root) {
    let attributes = undefined;
    let identifier = '';
    if (elem) {
        if (elem.data) {
            if (elem.data.attributes) {
                attributes = elem.data.attributes;
                identifier = elem.data.type;
            } else if (elem.data.node) {
                attributes = elem.data.node.attributes;
                identifier = elem.data.node.type;
            } else if (elem.data.state) {
                attributes = elem.data.state.attributes;
                identifier = elem.data.state.type;
            }
        } else {
            attributes = elem.attributes;
            identifer = elem.type;
        }
    } else if (xform) {
        attributes = xform;
        identifier = xform.transformation;
    }

    let metadata = undefined;
    if (elem)
        metadata = get_element_metadata(elem);
    else if (xform)
        metadata = get_transformation_metadata(xform);

    let sorted_attributes = {};
    Object.keys(attributes).forEach(k => {
        const val = attributes[k];
        if (k === 'layout' || k === 'sdfg' || k === 'sdfg_id' ||
            k === 'state_id' || k === 'expr_index' || k === 'type' ||
            k === 'transformation' || k === 'docstring' ||
            k === 'is_collapsed' || k === 'orig_sdfg' ||
            k === 'transformation_hist' || k.startsWith('_'))
            return;

        if (metadata && metadata[k]) {
            if (!sorted_attributes[metadata[k]['category']])
                sorted_attributes[metadata[k]['category']] = {};
            sorted_attributes[metadata[k]['category']][k] = val;
        } else {
            if (!sorted_attributes['Uncategorized'])
                sorted_attributes['Uncategorized'] = {};
            sorted_attributes['Uncategorized'][k] = val;
        }
    });

    const attr_table_base_container = $('<div>', {
        'class': 'container-fluid attr-table-base-container',
    }).appendTo(root);

    Object.keys(sorted_attributes).forEach(category => {
        if (category === '(Debug)')
            return;
        if (!Object.keys(sorted_attributes[category]).length)
            return;

        const cat_row = $('<div>', {
            'class': 'row attr-table-cat-row',
        }).appendTo(attr_table_base_container);
        const cat_container = $('<div>', {
            'class': 'col-12 attr-table-cat-container',
        }).appendTo(cat_row);

        const cat_toggle_btn = $('<button>', {
            'class': 'attr-cat-toggle-btn active',
            'type': 'button',
            'text': category,
            'data-bs-toggle': 'collapse',
            'data-bs-target': '#info-table-' + category + '-' + identifier,
            'aria-expanded': 'false',
            'aria-controls': 'info-table-' + category + '-' + identifier,
        }).appendTo(cat_container);
        $('<i>', {
            'class': 'attr-cat-toggle-btn-indicator material-icons',
            'text': 'expand_less'
        }).appendTo(cat_toggle_btn);

        const attr_table = $('<div>', {
            'class': 'container-fluid attr-table collapse show',
            'id': 'info-table-' + category + '-' + identifier,
        }).appendTo(cat_container);

        attr_table.on('hide.bs.collapse', () => {
            cat_toggle_btn.removeClass('active');
        });
        attr_table.on('show.bs.collapse', () => {
            cat_toggle_btn.addClass('active');
        });

        Object.keys(sorted_attributes[category]).forEach(k => {
            const val = attributes[k];

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
                k, val, attr_meta, attributes, elem, xform, attr_table, false,
                true, false
            );
        });
    });
}