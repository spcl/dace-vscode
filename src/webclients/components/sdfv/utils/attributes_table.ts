// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    Connector,
    Edge,
    LibraryNode, LogicalGroup, SDFGElement,
    SDFGNode,
    sdfg_property_to_string,
    State
} from '@spcl/sdfv/out';
import { editor as monaco_editor } from 'monaco-editor';
import { Range } from '../../../../types';
import {
    CodeProperty,
    ComboboxProperty,
    DictProperty,
    KeyProperty,
    ListProperty,
    LogicalGroupProperty,
    Property,
    PropertyEntry,
    RangeProperty,
    TypeclassProperty,
    ValueProperty
} from '../properties/properties';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { VSCodeSDFV } from '../vscode_sdfv';
import {
    createSingleUseModal,
    getElementMetadata,
    getTransformationMetadata,
    vscodeWriteGraph
} from './helpers';

declare const vscode: any;

function getMonacoThemeName() {
    switch ($('body').attr('data-vscode-theme-kind')) {
        case 'vscode-light':
            return 'vs';
        case 'vscode-high-contrast':
            return 'hs-black';
        case 'vscode-dark':
        default:
            return 'vs-dark';
    }
}

export function attrTablePutBool(
    key: string, subkey: string | undefined, val: boolean,
    elem: any | undefined, xform: any | undefined, target: any,
    cell: JQuery, dtype: string
): ValueProperty {
    const boolInputContainer = $('<div>', {
        'class': 'form-check form-switch sdfv-property-bool',
    }).appendTo(cell);
    const input = $('<input>', {
        'type': 'checkbox',
        'id': 'switch_' + key,
        'class': 'form-check-input',
        'checked': val,
    }).appendTo(boolInputContainer);
    boolInputContainer.append($('<label>', {
        'class': 'form-check-label',
        'text': ' ',
        'for': 'switch_' + key,
    }));
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutText(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string
): ValueProperty {
    const input = $('<input>', {
        'type': 'text',
        'class': 'sdfv-property-text',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutCode(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string
): CodeProperty {
    const sdfgMetaDict = VSCodeSDFV.getInstance().getMetaDict();

    let lang = 'Python';
    if (target[key])
        lang = target[key]['language'];

    const container = $('<div>', {
        'class': 'sdfv-property-code-container',
    }).appendTo(cell);

    const input = $('<div>', {
        'class': 'sdfv-property-monaco',
    }).appendTo(container);

    const languages: string[] = sdfgMetaDict ? sdfgMetaDict[
        '__reverse_type_lookup__'
    ]['Language'].choices : [];
    const languageInput = $('<select>', {
        'class': 'sdfv-property-dropdown',
    }).appendTo(container);
    languages.forEach(l => {
        languageInput.append(new Option(
            l,
            l,
            false,
            l === lang
        ));
    });

    const editor = monaco_editor.create(
        input.get(0)!, {
            'value': val,
            'language': lang === undefined ? 'python' : lang.toLowerCase(),
            'theme': getMonacoThemeName(),
            'glyphMargin': false,
            'lineDecorationsWidth': 0,
            'lineNumbers': 'off',
            'lineNumbersMinChars': 0,
            'minimap': {
                'enabled': false,
            },
            'padding': {
                'top': 0,
                'bottom': 0,
            },
        }
    );

    return new CodeProperty(
        elem, xform, target, key, subkey, dtype, input, languageInput, editor
    );
}

export function attrTablePutNumber(
    key: string, subkey: string | undefined, val: number, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string
): ValueProperty {
    const input = $('<input>', {
        'type': 'number',
        'class': 'sdfv-property-number',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutSelect(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    choices: string[]
): ValueProperty {
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
                        nodeId: [
                            elem.sdfg.sdfg_list_id,
                            elem.parent_id,
                            elem.id,
                        ],
                    });
            },
        }).appendTo(cell);

    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutTypeclass(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    choices: string[]
): TypeclassProperty {
    const input = $('<select>', {
        'id': key + '-typeclass-dropdown',
        'class': 'sdfv-property-dropdown',
    }).appendTo(cell);
    let found = false;
    if (choices) {
        choices.forEach(array => {
            input.append(new Option(
                array,
                array,
                array === val,
                array === val
            ));

            if (array === val)
                found = true;
        });
    }

    if (!found)
        input.append(new Option(val, val, true, true));

    input.editableSelect({
        filter: false,
        effects: 'fade',
        duration: 'fast',
    });

    return new TypeclassProperty(
        elem, xform, target, key, subkey, dtype, input,
        $('#' + key + '-typeclass-dropdown')
    );
}

export function attrTablePutDict(
    key: string, subkey: string | undefined, val: any, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    valMeta: any
): DictProperty {
    const dictCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfg_property_to_string(
            val, VSCodeRenderer.getInstance()?.view_settings()
        ),
    }).appendTo(dictCellContainer);
    const dictEditBtn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(dictCellContainer);

    const prop = new DictProperty(elem, xform, target, key, subkey, dtype, []);

    dictEditBtn.on('click', () => {
        prop.setProperties([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        Object.keys(val).forEach(k => {
            let v = val[k];
            const attrProp = attributeTablePutEntry(
                k, v, valMeta, val, elem, xform, rowbox, true, false, true
            );

            if (attrProp.deleteBtn)
                attrProp.deleteBtn.on('click', () => {
                    attrProp.keyProp?.getInput().val('');
                    attrProp.row.hide();
                });

            if (attrProp)
                prop.getProperties().push(attrProp);
        });

        // If code editors (monaco editors) are part of this dictionary, they
        // need to be resized again as soon as the modal is shown in order to
        // properly fill the container.
        modal.modal.on('shown.bs.modal', () => {
            for (const property of prop.getProperties()) {
                if (property.valProp instanceof CodeProperty)
                    property.valProp.getEditor().layout();
            }
        });

        const addItemContainer = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(addItemContainer);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                let newProp: PropertyEntry;
                if (valMeta)
                    newProp = attributeTablePutEntry(
                        '', '', valMeta, val, elem, xform, rowbox, true, false,
                        true
                    );
                else
                    newProp = attributeTablePutEntry(
                        '', '', { metatype: 'str' }, val, elem, xform, rowbox,
                        true, false, true
                    );
                if (newProp) {
                    prop.getProperties().push(newProp);

                    if (newProp.deleteBtn)
                        newProp.deleteBtn.on('click', () => {
                            newProp.keyProp?.getInput().val('');
                            newProp.row.hide();
                        });
                }
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(addItemButtonRow));

        if (modal.confirmBtn)
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                if (prop.update() && !xform && sdfg)
                    vscodeWriteGraph(sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

export function attrTablePutList(
    key: string, subkey: string | undefined, val: any[],
    elem: any | undefined, xform: any | undefined, target: any, cell: JQuery,
    dtype: string, elemMeta: any
): ListProperty {
    // If a list's element type is unknown, i.e. there is no element metadata,
    // treat it as a string so it can be edited properly.
    if (elemMeta === undefined)
        elemMeta = {
            metatype: 'str',
        };

    const listCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfg_property_to_string(
            val, VSCodeRenderer.getInstance()?.view_settings()
        ),
    }).appendTo(listCellContainer);
    const listCellEditBtn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(listCellContainer);

    const prop = new ListProperty(elem, xform, target, key, subkey, dtype, []);

    listCellEditBtn.on('click', () => {
        prop.setPropertiesList([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        if (val) {
            for (let i = 0; i < val.length; i++) {
                const v = val[i];
                const attrProp = attributeTablePutEntry(
                    i.toString(), v, elemMeta, val, elem, xform, rowbox, false,
                    false, true
                );

                if (attrProp.deleteBtn) {
                    attrProp.deleteBtn.on('click', () => {
                        if (attrProp.valProp) {
                            if (attrProp.valProp instanceof ValueProperty &&
                                attrProp.valProp.getInput()) {
                                attrProp.valProp.getInput().val('');
                            } else if (
                                attrProp.valProp instanceof LogicalGroupProperty
                            ) {
                                attrProp.valProp.getNameInput().val('');
                                attrProp.valProp.getColorInput().val('#000000');
                            }
                            attrProp.row.hide();
                        }
                    });
                }

                if (attrProp && attrProp.valProp)
                    prop.getPropertiesList().push(attrProp.valProp);
            }

            // If code editors (monaco editors) are part of this list, they
            // need to be resized again as soon as the modal is shown in order
            // to properly fill the container.
            modal.modal.on('shown.bs.modal', () => {
                for (const property of prop.getPropertiesList()) {
                    if (property instanceof CodeProperty)
                        property.getEditor().layout();
                }
            });
        }

        const addItemContainer = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const AddItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(addItemContainer);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                let i = prop.getPropertiesList().length;
                let newProp = attributeTablePutEntry(
                    i.toString(), '', elemMeta, val, elem, xform, rowbox, false,
                    false, true
                );
                if (newProp && newProp.valProp) {
                    prop.getPropertiesList().push(newProp.valProp);

                    if (newProp.deleteBtn) {
                        newProp.deleteBtn.on('click', () => {
                        if (newProp.valProp) {
                            if (newProp.valProp instanceof ValueProperty &&
                                newProp.valProp.getInput()) {
                                newProp.valProp.getInput().val('');
                            } else if (
                                newProp.valProp instanceof LogicalGroupProperty
                            ) {
                                newProp.valProp.getNameInput().val('');
                                newProp.valProp.getColorInput().val('#000000');
                            }
                            newProp.row.hide();
                        }
                        });
                    }
                }
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(AddItemButtonRow));

        if (modal.confirmBtn)
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                if (prop.update() && !xform && sdfg)
                    vscodeWriteGraph(sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

export function attrTablePutRange(
    key: string, subkey: string | undefined, val: any, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string
): RangeProperty {
    const rangeCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<td>', {
        'html': sdfg_property_to_string(
            val, VSCodeRenderer.getInstance()?.view_settings()
        ),
    }).appendTo(rangeCellContainer);
    const rangeEditBtn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(rangeCellContainer);

    const prop = new RangeProperty(
        elem, xform, target, key, 'ranges', dtype, []
    );

    rangeEditBtn.on('click', () => {
        prop.setRangeInputList([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        if (val && val.ranges)
            val.ranges.forEach((range: Range) => {
                const valRow = $('<div>', {
                    'class': 'row',
                }).appendTo(rowbox);

                const rangeStartInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': range.start,
                });
                const rangeStartContainer = $('<div>', {
                    'class': 'col-3 sdfv-property-range-delete-cell',
                }).appendTo(valRow);
                const deleteBtn = $('<span>', {
                    'class': 'material-icons-outlined sdfv-property-delete-btn',
                    'text': 'remove_circle',
                    'title': 'Delete entry',
                }).appendTo(rangeStartContainer);
                rangeStartContainer.append($('<div>').append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Start:',
                })).append(rangeStartInput));

                const rangeEndInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': range.end,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'End:',
                })).append(rangeEndInput);

                const rangeStepInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': range.step,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Step:',
                })).append(rangeStepInput);

                const rangeTileInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': range.tile,
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Tile:',
                })).append(rangeTileInput);

                deleteBtn.on('click', () => {
                    rangeStartInput.val('');
                    rangeEndInput.val('');
                    rangeStepInput.val('');
                    rangeTileInput.val('');
                    valRow.hide();
                });

                prop.getRangeInputList().push({
                    start: rangeStartInput,
                    end: rangeEndInput,
                    step: rangeStepInput,
                    tile: rangeTileInput,
                });
            });

        const addItemContainer = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(addItemContainer);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                const valRow = $('<div>', {
                    'class': 'row',
                }).appendTo(rowbox);

                const rangeStartInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': '',
                });
                const rangeStartContainer = $('<div>', {
                    'class': 'col-3 sdfv-property-range-delete-cell',
                }).appendTo(valRow);
                const deleteBtn = $('<span>', {
                    'class': 'material-icons-outlined sdfv-property-delete-btn',
                    'text': 'remove_circle',
                    'title': 'Delete entry',
                }).appendTo(rangeStartContainer);
                rangeStartContainer.append($('<div>').append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Start:',
                })).append(rangeStartInput));

                const rangeEndInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'End:',
                })).append(rangeEndInput);

                const rangeStepInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Step:',
                })).append(rangeStepInput);

                const rangeTileInput = $('<input>', {
                    'type': 'text',
                    'class': 'range-input sdfv-property-text',
                    'value': '',
                });
                $('<div>', {
                    'class': 'col-3',
                }).appendTo(valRow).append($('<span>', {
                    'class': 'range-input-label',
                    'text': 'Tile:',
                })).append(rangeTileInput);

                deleteBtn.on('click', () => {
                    rangeStartInput.val('');
                    rangeEndInput.val('');
                    rangeStepInput.val('');
                    rangeTileInput.val('');
                    valRow.hide();
                });

                prop.getRangeInputList().push({
                    start: rangeStartInput,
                    end: rangeEndInput,
                    step: rangeStepInput,
                    tile: rangeTileInput,
                });
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(addItemButtonRow));

        if (modal.confirmBtn)
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                if (prop.update() && !xform && sdfg)
                    vscodeWriteGraph(sdfg);
                modal.modal.modal('hide');
            });

        modal.modal.modal('show');
    });

    return prop;
}

export function attrTablePutLogicalGroup(
    key: string, subkey: string | undefined, val: LogicalGroup,
    elem: any | undefined, xform: any | undefined, target: any, cell: JQuery,
    dtype: string
): LogicalGroupProperty {
    const input = $('<input>', {
        'type': 'text',
        'class': 'sdfv-property-text',
        'value': val.name,
    }).appendTo(cell);
    const colorInput = $('<input>', {
        'type': 'color',
        'class': 'sdfv-property-color',
        'value': val.color,
    }).appendTo(cell);
    return new LogicalGroupProperty(
        elem, xform, target, key, undefined, dtype, input, colorInput
    );
}

export function attributeTablePutEntry(
    key: string, val: any, meta: any, target: any, elem: any | undefined,
    xform: any | undefined, root: JQuery, editableKey: boolean,
    updateOnChange: boolean, addDeleteButton: boolean
): PropertyEntry {
    let keyProp: KeyProperty | undefined = undefined;
    let valProp: Property | undefined = undefined;
    let deleteBtn = undefined;

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
    let keyCell = undefined;
    if (editableKey) {
        keyCell = $('<div>', {
            'class': 'col-3 attr-table-cell',
        }).appendTo(row);
        const keyInput = $('<input>', {
            'type': 'text',
            'class': 'property-key-input sdfv-property-text',
            'value': key,
        }).appendTo(keyCell);

        keyProp = new KeyProperty(elem, xform, target, key, keyInput);
    } else {
        keyCell = $('<div>', {
            'class': 'col-3 attr-table-heading attr-table-cell',
            'text': key,
        }).appendTo(row);
    }

    if (meta && meta['desc'])
        row.attr('title', meta['desc']);

    if (addDeleteButton) {
        keyCell.addClass('attr-table-cell-nopad');
        deleteBtn = $('<span>', {
            'class': 'material-icons-outlined sdfv-property-delete-btn',
            'text': 'remove_circle',
            'title': 'Delete entry',
        }).prependTo(keyCell);
    }

    const valueCell = $('<div>', {
        'class': 'col-9 attr-table-cell',
    }).appendTo(row);

    if (dtype === undefined) {
        // Implementations that are set to null should still be visible. Other
        // null properties should be shown as an empty field.
        if (key === 'implementation' && val === null)
            valueCell.html('null');
        else
            valueCell.html(sdfg_property_to_string(
                val, VSCodeRenderer.getInstance()?.view_settings()
            ));
    } else {
        const sdfgMetaDict = VSCodeSDFV.getInstance().getMetaDict();
        switch (dtype) {
            case 'typeclass':
                valProp = attrTablePutTypeclass(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    choices
                );
                break;
            case 'bool':
                valProp = attrTablePutBool(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            case 'str':
            case 'LambdaProperty':
            case 'SymbolicProperty':
                // TODO(later): Treat symbolic expressions with a symbolic
                // parser, they're not just a regular string.
                valProp = attrTablePutText(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            case 'int':
                valProp = attrTablePutNumber(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            case 'dict':
                let valType = undefined;
                let valMeta = undefined;
                if (meta !== undefined && meta['value_type'])
                    valType = meta['value_type'];
                if (sdfgMetaDict && valType &&
                    sdfgMetaDict['__reverse_type_lookup__'] &&
                    sdfgMetaDict['__reverse_type_lookup__'][valType])
                    valMeta = sdfgMetaDict['__reverse_type_lookup__'][valType];
                attrTablePutDict(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    valMeta
                );
                break;
            case 'set':
            case 'list':
            case 'tuple':
                let elemType = undefined;
                let elemMeta = undefined;
                if (meta !== undefined && meta['element_type'])
                    elemType = meta['element_type'];
                if (sdfgMetaDict && elemType &&
                    sdfgMetaDict['__reverse_type_lookup__'] &&
                    sdfgMetaDict['__reverse_type_lookup__'][elemType])
                    elemMeta =
                        sdfgMetaDict['__reverse_type_lookup__'][elemType];

                if (elemMeta === undefined && elemType)
                    elemMeta = {
                        metatype: elemType,
                    };

                valProp = attrTablePutList(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    elemMeta
                );
                break;
            case 'Range':
            case 'SubsetProperty':
                valProp = attrTablePutRange(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            case 'DataProperty':
                valProp = attrTablePutSelect(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    elem ? Object.keys(elem.sdfg.attributes._arrays): []
                );
                break;
            case 'CodeBlock':
                valProp = attrTablePutCode(
                    key, undefined, val ? val.string_data : '', elem, xform,
                    target, valueCell, dtype
                );
                break;
            case 'LogicalGroup':
                valProp = attrTablePutLogicalGroup(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                );
                break;
            default:
                if (choices !== undefined) {
                    valProp = attrTablePutSelect(
                        key, undefined, val, elem, xform, target, valueCell,
                        dtype, choices
                    );
                } else {
                    valueCell.html(sdfg_property_to_string(
                        val, VSCodeRenderer.getInstance()?.view_settings()
                    ));
                }
                break;
        }
    }

    if (updateOnChange && valProp !== undefined) {
        if (valProp instanceof ValueProperty) {
            if (valProp instanceof ComboboxProperty) {
                valProp.getInput().on('hidden.editable-select', () => {
                    if (valProp) {
                        const valueChanged = valProp.update();
                        const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                        if (!xform && valueChanged && sdfg)
                            vscodeWriteGraph(sdfg);
                    }
                });
                valProp.getInput().on('select.editable-select', () => {
                    if (valProp) {
                        const valueChanged = valProp.update();
                        const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                        if (!xform && valueChanged && sdfg)
                            vscodeWriteGraph(sdfg);
                    }
                });
            } else {
                valProp.getInput().on('change', () => {
                    if (valProp) {
                        valProp.update();
                        const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                        if (!xform && sdfg)
                            vscodeWriteGraph(sdfg);
                    }
                });
            }
        } else if (valProp instanceof CodeProperty) {
            valProp.getCodeInput().on('change', () => {
                if (valProp) {
                    valProp.update();
                    const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                    if (!xform && sdfg)
                        vscodeWriteGraph(sdfg);
                }
            });
            valProp.getLangInput().on('change', () => {
                if (valProp) {
                    valProp.update();
                    const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                    if (!xform && sdfg)
                        vscodeWriteGraph(sdfg);
                }
            });
        }
    }

    if (updateOnChange && keyProp !== undefined &&
        keyProp.getInput() !== undefined)
        keyProp.getInput().on('change', () => {
            const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
            if (keyProp && keyProp.update() && !xform && sdfg)
                vscodeWriteGraph(sdfg);
        });

    return {
        keyProp: keyProp,
        valProp: valProp,
        deleteBtn: deleteBtn,
        row: row,
    };
}

export function generateAttributesTable(
    elem: any | undefined, xform: any | undefined, root: JQuery<HTMLElement>
): void {
    let attributes: any | undefined = undefined;
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
            identifier = elem.type;
        }
    } else if (xform) {
        attributes = xform;
        identifier = xform.transformation;
    }

    let metadata: any | undefined = undefined;
    if (elem)
        metadata = getElementMetadata(elem);
    else if (xform)
        metadata = getTransformationMetadata(xform);

    let sortedAttributes: { [key: string]: any } = {};
    Object.keys(attributes).forEach(k => {
        const val = attributes[k];
        if (k === 'layout' || k === 'sdfg' || k === 'sdfg_id' ||
            k === 'state_id' || k === 'expr_index' || k === 'type' ||
            k === 'transformation' || k === 'docstring' ||
            k === 'is_collapsed' || k === 'orig_sdfg' || k === 'position' ||
            k === 'transformation_hist' || k.startsWith('_'))
            return;

        if (metadata && metadata[k]) {
            if (!sortedAttributes[metadata[k]['category']])
                sortedAttributes[metadata[k]['category']] = {};
            sortedAttributes[metadata[k]['category']][k] = val;
        } else {
            if (!sortedAttributes['Uncategorized'])
                sortedAttributes['Uncategorized'] = {};
            sortedAttributes['Uncategorized'][k] = val;
        }
    });

    const attrTableBaseContainer = $('<div>', {
        'class': 'container-fluid attr-table-base-container',
    }).appendTo(root);

    Object.keys(sortedAttributes).forEach(category => {
        if (category === '(Debug)')
            return;
        if (!Object.keys(sortedAttributes[category]).length)
            return;

        const catRow = $('<div>', {
            'class': 'row attr-table-cat-row',
        }).appendTo(attrTableBaseContainer);
        const catContainer = $('<div>', {
            'class': 'col-12 attr-table-cat-container',
        }).appendTo(catRow);

        const catToggleBtn = $('<button>', {
            'class': 'attr-cat-toggle-btn active',
            'type': 'button',
            'text': category,
            'data-bs-toggle': 'collapse',
            'data-bs-target': '#info-table-' + category + '-' + identifier,
            'aria-expanded': 'false',
            'aria-controls': 'info-table-' + category + '-' + identifier,
        }).appendTo(catContainer);
        $('<i>', {
            'class': 'attr-cat-toggle-btn-indicator material-icons',
            'text': 'expand_less'
        }).appendTo(catToggleBtn);

        const attrTable = $('<div>', {
            'class': 'container-fluid attr-table collapse show',
            'id': 'info-table-' + category + '-' + identifier,
        }).appendTo(catContainer);

        attrTable.on('hide.bs.collapse', () => {
            catToggleBtn.removeClass('active');
        });
        attrTable.on('show.bs.collapse', () => {
            catToggleBtn.addClass('active');
        });

        Object.keys(sortedAttributes[category]).forEach(k => {
            const val = attributes[k];

            // Debug info isn't printed in the attributes table, but instead we
            // show a button to jump to the referenced code location.
            if (k === 'debuginfo') {
                if (val) {
                    const gotoSourceBtn = $('#goto-source-btn');
                    gotoSourceBtn.on('click', function() {
                        VSCodeSDFV.getInstance().gotoSource(
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

            let attrMeta = undefined;
            if (metadata && metadata[k])
                attrMeta = metadata[k];

            attributeTablePutEntry(
                k, val, attrMeta, attributes, elem, xform, attrTable, false,
                true, false
            );
        });
    });

    // Dsiplay a button to jump to the generated C++ code
    if (
        elem instanceof SDFGElement &&
        !(elem instanceof Edge) &&
        !(elem instanceof Connector)
    ) {
        const gotoCppBtn = $('#goto-cpp-btn');
        const undefinedVal = -1;
        let sdfgName =
            VSCodeRenderer.getInstance()?.get_sdfg()?.attributes.name;
        let sdfgId = elem.sdfg.sdfg_list_id;
        let stateId = undefinedVal;
        let nodeId = undefinedVal;

        if (elem instanceof State) {
            stateId = elem.id;
        }
        else if (elem instanceof Node) {
            if (elem.parent_id === null)
                stateId = undefinedVal;
            else
                stateId = elem.parent_id;
            nodeId = elem.id;
        }

        gotoCppBtn.on('click', function () {
            VSCodeSDFV.getInstance().gotoCpp(
                sdfgName,
                sdfgId,
                stateId,
                nodeId
            );
        });
        gotoCppBtn.prop(
            'title',
            sdfgName + ':' +
                sdfgId +
                (stateId === undefinedVal) ? '' : (':' + stateId +
                    (nodeId === undefinedVal) ? '' : (':' + nodeId))
        );
        gotoCppBtn.show();
    }
}
