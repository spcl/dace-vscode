// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

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
                    let exit_idx = node_type.indexOf('Entry');
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

function generate_attributes_table(elem, attributes, root) {
    let metadata = get_element_metadata(elem);

    for (const attr of attributes) {
        if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
            attr[0] === 'is_collapsed' || attr[0] === 'orig_sdfg' ||
            attr[0] === 'transformation_hist' || attr[0].startsWith('_'))
            continue;

        const val = sdfg_property_to_string(attr[1], renderer.view_settings());

        let datatype = undefined;
        let choices = undefined;
        if (metadata && metadata[attr[0]]) {
            if (metadata[attr[0]]['metatype'])
                datatype = metadata[attr[0]]['metatype'];
            if (metadata[attr[0]]['choices'])
                choices = metadata[attr[0]]['choices'];
        }

        if (attr[0] === 'debuginfo') {
            if (attr[1]) {
                const gotoSourceBtn = $('#goto-source-btn');
                gotoSourceBtn.on('click', function() {
                    gotoSource(
                        attr[1].filename,
                        attr[1].start_line,
                        attr[1].start_column,
                        attr[1].end_line,
                        attr[1].end_column
                    );
                });
                gotoSourceBtn.prop(
                    'title',
                    attr[1].filename + ':' + attr[1].start_line
                );
                gotoSourceBtn.show();
            }
            continue;
        }

        const row = $('<tr>').appendTo(root);
        const title_cell = $('<th>', {
            'class': 'key-col',
            'text': attr[0],
        }).appendTo(row);

        let input_element = undefined;
        if (datatype === 'bool') {
            const attr_bool_box_container = $('<div>', {
                'class': 'custom-control custom-switch',
            });
            const attr_bool_box = $('<input>', {
                'type': 'checkbox',
                'id': 'switch_' + attr[0],
                'class': 'custom-control-input',
                'checked': attr[1],
            }).appendTo(attr_bool_box_container);
            const table_cell = $('<td>', {
                'class': 'val-col',
            }).appendTo(row);
            table_cell.append(attr_bool_box_container);
            attr_bool_box_container.append($('<label>', {
                'class': 'custom-control-label',
                'text': ' ',
                'for': 'switch_' + attr[0],
            }));

            attr_bool_box.on('change', () => {
                const new_val = attr_bool_box.is(':checked');
                if (elem.data) {
                    if (elem.data.attributes)
                        elem.data.attributes[attr[0]] = new_val;
                    else if (elem.data.node)
                        elem.data.node.attributes[attr[0]] = new_val;
                    else if (elem.data.state)
                        elem.data.state.attributes[attr[0]] = new_val;
                } else if (elem.attributes) {
                    elem.attributes[attr[0]] = new_val;
                }

                vscode_write_graph(renderer.sdfg);
            });
        } else if (datatype === 'str' || datatype === 'SymbolicProperty') {
            const attr_text_box = $('<input>', {
                'type': 'text',
                'value': attr[1],
            });
            const table_cell = $('<td>', {
                'class': 'val-col',
            }).appendTo(row);
            table_cell.append(attr_text_box);
            input_element = attr_text_box;
        } else if (datatype === 'int') {
            const attr_number_box = $('<input>', {
                'type': 'number',
                'value': attr[1],
            });
            const table_cell = $('<td>', {
                'class': 'val-col',
            }).appendTo(row);
            table_cell.append(attr_number_box);
            input_element = attr_number_box;
        } else if (datatype === 'dict') {
            const dict_cell = $('<td>', {
                'class': 'val-col clickable-val-col',
                'title': 'Click to edit',
                'html': val,
            }).appendTo(row);
            dict_cell.on('click', () => {
                reusable_modal_title.text(attr[0]);
                const rowbox = $('<div>', {
                    'class': 'container_fluid',
                }).appendTo(reusable_modal_content);

                const dict_inputs = [];

                if (attr[1])
                    Object.keys(attr[1]).forEach(key => {
                        const val_row = $('<div>', {
                            'class': 'row',
                        }).appendTo(rowbox);
                        const dict_input_key = $('<input>', {
                            'type': 'text',
                            'class': 'col-4',
                            'value': key,
                        }).appendTo(val_row);
                        const dict_input_val = $('<input>', {
                            'type': 'text',
                            'class': 'col-8',
                            'value': attr[1][key] ? attr[1][key] : '',
                        }).appendTo(val_row);
                        dict_inputs.push({
                            key: dict_input_key,
                            val: dict_input_val,
                        });
                    });

                const add_item_container = $('<div>', {
                    'class': 'container_fluid',
                }).appendTo(reusable_modal_content);
                const add_item_button_row = $('<div>', {
                    'class': 'row',
                }).appendTo(add_item_container);
                $('<button>', {
                    'class': 'btn btn-primary col-2',
                    'text': '+',
                    'title': 'Add item',
                    'click': () => {
                        const val_row = $('<div>', {
                            'class': 'row',
                        }).appendTo(rowbox);
                        const dict_input_key = $('<input>', {
                            'type': 'text',
                            'class': 'col-4',
                            'value': '',
                        }).appendTo(val_row);
                        const dict_input_val = $('<input>', {
                            'type': 'text',
                            'class': 'col-8',
                            'value': '',
                        }).appendTo(val_row);
                        dict_inputs.push({
                            key: dict_input_key,
                            val: dict_input_val,
                        });
                    },
                }).appendTo(add_item_button_row);

                reusable_modal_btn_confirm.on('click', () => {
                    const new_dict_attr = {};
                    for (
                        let dict_input_idx = 0;
                        dict_input_idx < dict_inputs.length;
                        dict_input_idx++
                    ) {
                        const dict_input = dict_inputs[dict_input_idx];
                        if (dict_input.key.val() !== '' &&
                            dict_input.key.val() !== undefined) {
                            let new_val = null;
                            if (dict_input.val.val() !== '' &&
                                dict_input.val.val() !== undefined)
                                new_val = dict_input.val.val();
                            new_dict_attr[dict_input.key.val()] = new_val;
                        }
                    }

                    if (elem.data) {
                        if (elem.data.attributes)
                            elem.data.attributes[attr[0]] = new_dict_attr;
                        else if (elem.data.node)
                            elem.data.node.attributes[attr[0]] = new_dict_attr;
                        else if (elem.data.state)
                            elem.data.state.attributes[attr[0]] = new_dict_attr;
                    } else if (elem.attributes) {
                        elem.attributes[attr[0]] = new_dict_attr;
                    }

                    vscode_write_graph(renderer.sdfg);

                    reusable_modal.modal('hide');
                });

                reusable_modal.modal('show');
            });
        } else if (datatype === 'set' || datatype === 'list' ||
                    datatype === 'tuple') {
            const dict_cell = $('<td>', {
                'class': 'val-col clickable-val-col',
                'title': 'Click to edit',
                'html': val,
            }).appendTo(row);
            dict_cell.on('click', () => {
                reusable_modal_title.text(attr[0]);
                const rowbox = $('<div>', {
                    'class': 'container_fluid',
                }).appendTo(reusable_modal_content);

                const list_inputs = [];

                if (attr[1])
                    attr[1].forEach(v => {
                        const val_row = $('<div>', {
                            'class': 'row',
                        }).appendTo(rowbox);
                        list_inputs.push($('<input>', {
                            'type': 'text',
                            'class': 'col-12',
                            'value': v ? v : '',
                        }).appendTo(val_row));
                    });

                const add_item_container = $('<div>', {
                    'class': 'container_fluid',
                }).appendTo(reusable_modal_content);
                const add_item_button_row = $('<div>', {
                    'class': 'row',
                }).appendTo(add_item_container);
                $('<button>', {
                    'class': 'btn btn-primary col-2',
                    'text': '+',
                    'title': 'Add item',
                    'click': () => {
                        const val_row = $('<div>', {
                            'class': 'row',
                        }).appendTo(rowbox);
                        list_inputs.push($('<input>', {
                            'type': 'text',
                            'class': 'col-12',
                            'value': '',
                        }).appendTo(val_row));
                    },
                }).appendTo(add_item_button_row);

                reusable_modal_btn_confirm.on('click', () => {
                    const new_list_attr = [];
                    for (
                        let list_input_idx = 0;
                        list_input_idx < list_inputs.length;
                        list_input_idx++
                    ) {
                        const linput = list_inputs[list_input_idx];
                        if (linput.val() !== '' && linput !== undefined)
                            new_list_attr.push(linput.val());
                    }

                    if (elem.data) {
                        if (elem.data.attributes)
                            elem.data.attributes[attr[0]] = new_list_attr;
                        else if (elem.data.node)
                            elem.data.node.attributes[attr[0]] = new_list_attr;
                        else if (elem.data.state)
                            elem.data.state.attributes[attr[0]] = new_list_attr;
                    } else if (elem.attributes) {
                        elem.attributes[attr[0]] = new_list_attr;
                    }

                    vscode_write_graph(renderer.sdfg);

                    reusable_modal.modal('hide');
                });

                reusable_modal.modal('show');
            });
        } else if (datatype === 'Range' || datatype === 'SubsetProperty') {
            const range_cell = $('<td>', {
                'class': 'val-col clickable-val-col',
                'title': 'Click to edit',
                'html': val,
            }).appendTo(row);
            range_cell.on('click', () => {
                reusable_modal_title.text(attr[0]);

                const rowbox = $('<div>', {
                    'class': 'container_fluid',
                }).appendTo(reusable_modal_content);
                let ranges_inputs = [];
                if (attr[1])
                    attr[1].ranges.forEach(range => {
                        const val_row = $('<div>', {
                            'class': 'row',
                        }).appendTo(rowbox);

                        const range_start_input = $('<input>', {
                            'type': 'text',
                            'class': 'range-input',
                            'value': range.start
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
                            'value': range.end
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
                            'value': range.step
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
                            'value': range.tile
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

                reusable_modal_btn_confirm.on('click', () => {
                    let ranges = undefined;
                    if (elem.data) {
                        if (elem.data.attributes)
                            ranges = elem.data.attributes[attr[0]].ranges;
                        else if (elem.data.node)
                            ranges = elem.data.node.attributes[attr[0]].ranges;
                        else if (elem.data.state)
                            ranges = elem.data.state.attributes[attr[0]].ranges;
                    } else if (elem.attributes) {
                        ranges = elem.attributes[attr[0]].ranges;
                    }

                    for (
                        let range_idx = 0;
                        range_idx < ranges.length;
                        range_idx++
                    ) {
                        let target_range = ranges[range_idx];
                        let range_input = ranges_inputs[range_idx];
                        target_range.start = range_input.start.val();
                        target_range.end = range_input.end.val();
                        target_range.step = range_input.step.val();
                        target_range.tile = range_input.tile.val();
                    }

                    vscode_write_graph(renderer.sdfg);

                    reusable_modal.modal('hide');
                });

                reusable_modal.modal('show');
            });
        } else if (datatype === 'DataProperty') {
            const cell = $('<td>', {
                'class': 'val-col',
            }).appendTo(row);

            const attr_data_prop_box = $('<select>', {
                'class': 'sdfv-property-dropdown',
            }).appendTo(cell);
            input_element = attr_data_prop_box;

            Object.keys(elem.sdfg.attributes._arrays).forEach(array => {
                attr_data_prop_box.append(new Option(
                    array,
                    array,
                    false,
                    array === attr[1]
                ));
            });
        } else if (datatype === 'CodeBlock') {
            const attr_code_box = $('<input>', {
                'type': 'text',
                'value': attr[1] ? attr[1].string_data : '',
            });
            const table_cell = $('<td>', {
                'class': 'val-col',
            }).appendTo(row);
            table_cell.append(attr_code_box);

            attr_code_box.on('change', () => {
                if (elem.data) {
                    if (elem.data.attributes)
                        elem.data.attributes[attr[0]].string_data =
                            attr_code_box.val();
                    else if (elem.data.node)
                        elem.data.node.attributes[attr[0]].string_data =
                            attr_code_box.val();
                    else if (elem.data.state)
                        elem.data.state.attributes[attr[0]].string_data =
                            attr_code_box.val();
                } else if (elem.attributes) {
                    elem.attributes[attr[0]].string_data = attr_code_box.val();
                }

                vscode_write_graph(renderer.sdfg);
            });
        } else if (datatype === 'LambdaProperty') {
            const attr_lambda_box = $('<input>', {
                'type': 'text',
                'value': attr[1],
            });
            const table_cell = $('<td>', {
                'class': 'val-col',
            }).appendTo(row);
            table_cell.append(attr_lambda_box);

            attr_lambda_box.on('change', () => {
                let new_val = attr_lambda_box.val();
                if (new_val === '' || new_val === undefined)
                    new_val = null;

                if (elem.data) {
                    if (elem.data.attributes)
                        elem.data.attributes[attr[0]] = new_val;
                    else if (elem.data.node)
                        elem.data.node.attributes[attr[0]] = new_val;
                    else if (elem.data.state)
                        elem.data.state.attributes[attr[0]] = new_val;
                } else if (elem.attributes) {
                    elem.attributes[attr[0]] = new_val;
                }

                vscode_write_graph(renderer.sdfg);
            });
        } else {
            if (choices !== undefined) {
                const cell = $('<td>', {
                    'class': 'val-col',
                }).appendTo(row);

                const attr_select_box = $('<select>', {
                    'class': 'sdfv-property-dropdown',
                }).appendTo(cell);
                input_element = attr_select_box;

                choices.forEach(el => {
                    attr_select_box.append(new Option(
                        el,
                        el,
                        false,
                        el === attr[1]
                    ));
                });
            } else {
                $('<td>', {
                    'class': 'val-col',
                    'html': val,
                }).appendTo(row);
                if (datatype !== undefined)
                    title_cell.text(title_cell.text() + ' (' + datatype + ')');
            }
        }

        if (input_element !== undefined)
            input_element.on('change', () => {
                if (elem.data) {
                    if (elem.data.attributes)
                        elem.data.attributes[attr[0]] = input_element.val();
                    else if (elem.data.node)
                        elem.data.node.attributes[attr[0]] =
                            input_element.val();
                    else if (elem.data.state)
                        elem.data.state.attributes[attr[0]] =
                            input_element.val();
                } else if (elem.attributes) {
                    elem.attributes[attr[0]] = input_element.val();
                }

                vscode_write_graph(renderer.sdfg);
            });
    }
}