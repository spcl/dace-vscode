// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    Connector,
    Edge,
    JsonSDFG,
    JsonSDFGNode,
    LibraryNode,
    LogicalGroup,
    SDFGElement,
    sdfg_property_to_string,
    State,
    SDFG
} from '@spcl/sdfv/src';
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
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';
import {
    createSingleUseModal,
    doForAllNodeTypes,
    getElementMetadata,
    getTransformationMetadata,
    vscodeWriteGraph
} from './helpers';
import { ComponentTarget } from '../../../../components/components';

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
    let lang = 'Python';
    if (target[key])
        lang = target[key]['language'];

    const container = $('<div>', {
        'class': 'sdfv-property-code-container',
    }).appendTo(cell);

    const input = $('<div>', {
        'class': 'sdfv-property-monaco',
    }).appendTo(container);

    const languageInput = $('<select>', {
        'class': 'sdfv-property-dropdown',
    }).appendTo(container);
    VSCodeSDFV.getInstance().getMetaDict().then(sdfgMetaDict => {
        const languages: string[] =
            sdfgMetaDict['__reverse_type_lookup__']['Language'].choices;
        languages.forEach(l => {
            languageInput.append(new Option(
                l,
                l,
                false,
                l === lang
            ));
        });
    });

    const editor = monaco_editor.create(
        input.get(0)!, {
            value: val,
            language: lang === undefined ? 'python' : lang.toLowerCase(),
            theme: getMonacoThemeName(),
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbers: 'off',
            lineNumbersMinChars: 0,
            minimap: {
                enabled: false,
            },
            padding: {
                top: 0,
                bottom: 0,
            },
            automaticLayout: true,
        }
    );

    return new CodeProperty(
        elem, xform, target, key, subkey, dtype, input, languageInput, editor
    );
}

export function attrTablePutData(
    key: string, subkey: string | undefined, val: any, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    meta: any, editableKeys: boolean = false
): DictProperty {
    const dataCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    const dataEditBtn = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(dataCellContainer);

    const prop = new DictProperty(
        elem, xform, target, key, subkey, dtype, [], val
    );

    dataEditBtn.on('click', () => {
        prop.setProperties([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        Object.keys(val.attributes).forEach(async k => {
            let v = val.attributes[k];

            let valMeta = undefined;
            if (k in meta)
                valMeta = meta[k];

            const row = $('<div>', {
                class: 'row attr-table-row',
            }).appendTo(rowbox);
            const attrProp = await attributeTablePutEntry(
                k, v, valMeta, val.attributes, elem, xform, row,
                editableKeys, false, editableKeys
            );

            if (attrProp.deleteBtn)
                attrProp.deleteBtn.on('click', () => {
                    attrProp.keyProp?.getInput().val('');
                    attrProp.keyProp?.markDeleted();
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
                property.valProp?.forEach(vProp => {
                    if (vProp instanceof CodeProperty)
                        vProp.getEditor().layout();
                });
            }
        });

        if (editableKeys) {
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
                'click': async () => {
                    const row = $('<div>', {
                        class: 'row attr-table-row',
                    }).appendTo(rowbox);
                    const newProp = await attributeTablePutEntry(
                        '', '', { metatype: 'str' }, val.attributes, elem,
                        xform, row, true, false, true
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
        }

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

    if (elem && elem instanceof LibraryNode && key === 'implementation') {
        const expandButton =  $('<button>', {
            'class': 'btn btn-sm btn-primary sdfv-property-expand-libnode-btn',
            'text': 'Expand',
            'click': () => {
                const nodeId = [
                    elem.sdfg.sdfg_list_id,
                    elem.parent_id,
                    elem.id,
                ];
                SDFVComponent.getInstance().invoke(
                    'expandLibraryNode', [nodeId], ComponentTarget.DaCe
                );
            },
        }).appendTo(cell);
        const inPreviewMode = $('#exit-preview-button').is(':visible');
        if (inPreviewMode) {
            expandButton.prop('disabled', 'disabled');
            expandButton.addClass('btn-disabled');
            expandButton.prop(
                'title', 'Cannot expand in preview mode'
            );
        }
    }

    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

export function attrTablePutTypeclass(
    key: string, subkey: string | undefined, val: string, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    baseTypes: string[], compoundTypes: { [keys: string]: any }
): TypeclassProperty {
    // Add a random string to the id so we can fetch the new element after an
    // editable select is created. Passing the element directly doesn't use the
    // updated fields created by editable select.
    const r = (Math.random() + 1).toString(36).substring(7);
    const input = $('<select>', {
        'id': key + '-' + r + '-typeclass-dropdown',
        'class': 'sdfv-property-dropdown',
    }).appendTo(cell);
    const choices = baseTypes.concat(Object.keys(compoundTypes));

    const typeval = val ? (typeof val === 'object' ? val['type'] : val) : null;
    let found = false;
    if (choices) {
        choices.forEach(array => {
            input.append(new Option(
                array,
                array,
                array === typeval,
                array === typeval
            ));

            if (array === typeval)
                found = true;
        });
    }

    if (!found && typeval)
        input.append(new Option(typeval, typeval, true, true));

    input.editableSelect({
        filter: false,
        effects: 'fade',
        duration: 'fast',
    });

    const editCompoundButton = $('<i>', {
        'class': 'material-icons property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(cell);
    if (typeof val === 'string')
        editCompoundButton.hide();

    return new TypeclassProperty(
        elem, xform, target, key, subkey, dtype, input,
        $('#' + key + '-' + r + '-typeclass-dropdown'), editCompoundButton,
        compoundTypes
    );
}

export function attrTablePutDict(
    key: string, subkey: string | undefined, val: any, elem: any | undefined,
    xform: any | undefined, target: any, cell: JQuery, dtype: string,
    valMeta: any, allowAdding: boolean = true
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

    const prop = new DictProperty(
        elem, xform, target, key, subkey, dtype, [], val
    );

    dictEditBtn.on('click', () => {
        prop.setProperties([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        Object.keys(val).forEach(async k => {
            let v = val[k];
            const row = $('<div>', {
                class: 'row attr-table-row',
            }).appendTo(rowbox);
            const attrProp = await attributeTablePutEntry(
                k, v, valMeta, val, elem, xform, row, true, false, true
            );

            if (attrProp.deleteBtn)
                attrProp.deleteBtn.on('click', () => {
                    attrProp.keyProp?.getInput().val('');
                    attrProp.keyProp?.markDeleted();
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
                property.valProp?.forEach(vProp => {
                    if (vProp instanceof CodeProperty)
                        vProp.getEditor().layout();
                });
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
                const row = $('<div>', {
                    class: 'row attr-table-row',
                }).appendTo(rowbox);
                let newPropRet: Promise<PropertyEntry>;
                if (valMeta)
                    newPropRet = attributeTablePutEntry(
                        '', '', valMeta, val, elem, xform, row, true, false,
                        true
                    );
                else
                    newPropRet = attributeTablePutEntry(
                        '', '', { metatype: 'str' }, val, elem, xform, row,
                        true, false, true
                    );
                newPropRet.then(newProp => {
                    if (newProp) {
                        prop.getProperties().push(newProp);

                        if (newProp.deleteBtn)
                            newProp.deleteBtn.on('click', () => {
                                newProp.keyProp?.getInput().val('');
                                newProp.row.hide();
                            });
                    }
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

    const prop = new ListProperty(
        elem, xform, target, key, subkey, dtype, [], val
    );

    listCellEditBtn.on('click', async () => {
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
                const row = $('<div>', {
                    class: 'row attr-table-row',
                }).appendTo(rowbox);
                const attrProp = await attributeTablePutEntry(
                    i.toString(), v, elemMeta, val, elem, xform, row, false,
                    false, true
                );

                if (attrProp.deleteBtn) {
                    attrProp.deleteBtn.on('click', () => {
                        attrProp.valProp?.forEach(vProp => {
                            vProp.markDeleted();
                        });
                        attrProp.row.hide();
                    });
                }

                if (attrProp && attrProp.valProp)
                    prop.getPropertiesList().push(...attrProp.valProp);
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
                const row = $('<div>', {
                    class: 'row attr-table-row',
                }).appendTo(rowbox);
                attributeTablePutEntry(
                    i.toString(), '', elemMeta, val, elem, xform, row, false,
                    false, true
                ).then(newProp => {
                    if (newProp && newProp.valProp) {
                        prop.getPropertiesList().push(...newProp.valProp);

                        if (newProp.deleteBtn) {
                            newProp.deleteBtn.on('click', () => {
                                newProp.valProp?.forEach(vProp => {
                                    vProp.markDeleted();
                                    newProp.row.hide();
                                });
                            });
                        }
                    }
                });
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
        elem, xform, target, key, 'ranges', dtype, [], val
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

export async function attributeTablePutEntry(
    key: string, val: any, meta: any, target: any, elem: any | undefined,
    xform: any | undefined, row: JQuery, editableKey: boolean,
    updateOnChange: boolean, addDeleteButton: boolean,
    keyChangeHandlerOverride?: (prop: KeyProperty) => void,
    valueChangeHandlerOverride?: (prop: Property) => void,
    invertedSpacing: boolean = false
): Promise<PropertyEntry> {
    let keyProp: KeyProperty | undefined = undefined;
    let valProp: Property[] | undefined = undefined;
    let deleteBtn = undefined;

    const wrapperRow = $('<div>', {
        class: 'd-flex flex-row align-items-center p-0',
    }).appendTo(row);
    const prefixCell = $('<div>', {
        class: 'attr-row-prefix-cell',
    }).appendTo(wrapperRow);
    const contentCell = $('<div>', {
        class: 'attr-row-content-cell flex-grow-1',
    }).appendTo(wrapperRow);
    const contentCellWrapper = $('<div>', {
        class: 'container-fluid'
    }).appendTo(contentCell);
    const contentRow = $('<div>', {
        class: 'row',
    }).appendTo(contentCellWrapper);

    let dtype = undefined;
    let choices = undefined;
    if (meta) {
        if (meta['metatype'])
            dtype = meta['metatype'];
        if (meta['choices'])
            choices = meta['choices'];
    }

    const valPropUpdateHandler = valueChangeHandlerOverride !== undefined ?
        valueChangeHandlerOverride : (prop: Property) => {
            const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
            if (prop && prop.update() && !xform && sdfg)
                vscodeWriteGraph(sdfg);
        };

    const keyPropUpdateHandler = keyChangeHandlerOverride !== undefined ?
        keyChangeHandlerOverride : (prop: KeyProperty) => {
            const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
            if (prop && prop.update() && !xform && sdfg)
                vscodeWriteGraph(sdfg);
        };

    let keyCell = undefined;
    if (editableKey) {
        keyCell = $('<div>', {
            'class': 'attr-table-cell ' + (
                invertedSpacing ? 'attr-cell-l' : 'attr-cell-s'
            ),
        }).appendTo(contentRow);
        const keyInput = $('<input>', {
            'type': 'text',
            'class': 'property-key-input sdfv-property-text',
            'value': key,
        }).appendTo(keyCell);

        keyProp = new KeyProperty(elem, xform, target, key, keyInput);
    } else {
        keyCell = $('<div>', {
            'class': 'attr-table-heading attr-table-cell ' + (
                invertedSpacing ? 'attr-cell-l' : 'attr-cell-s'
            ),
            'text': key,
        }).appendTo(contentRow);
    }

    if (meta && meta['desc'])
        row.attr('title', meta['desc']);

    if (addDeleteButton) {
        const deleteWrapper = $('<div>', {
            style: 'height: 100%; display: flex; align-items: center;',
        }).appendTo(prefixCell);
        deleteBtn = $('<span>', {
            'class': 'material-icons-outlined sdfv-property-delete-btn',
            'text': 'remove_circle',
            'title': 'Delete entry',
        }).appendTo(deleteWrapper);
    }

    const valueCell = $('<div>', {
        'class': 'attr-table-cell ' + (
            invertedSpacing ? 'attr-cell-s' : 'attr-cell-l'
        ),
    }).appendTo(contentRow);

    if (key === 'constants_prop') {
        const constContainer = $('<div>').appendTo(valueCell);
        for (const k in val) {
            const v = val[k];
            constContainer.append($('<div>', {
                text: k + ': ' + v[1].toString(),
            }));
        }
    } else if (dtype === undefined) {
        // Implementations that are set to null should still be visible. Other
        // null properties should be shown as an empty field.
        if (key === 'implementation' && val === null)
            valueCell.html('null');
        else
            valueCell.html(sdfg_property_to_string(
                val, VSCodeRenderer.getInstance()?.view_settings()
            ));
    } else {
        const sdfgMetaDict = await VSCodeSDFV.getInstance().getMetaDict();
        switch (dtype) {
            case 'typeclass':
                if (meta !== undefined && meta['base_types'] &&
                    meta['compound_types'])
                    valProp = [attrTablePutTypeclass(
                        key, undefined, val, elem, xform, target, valueCell,
                        dtype, meta['base_types'], meta['compound_types']
                    )];
                break;
            case 'bool':
                valProp = [attrTablePutBool(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                )];
                break;
            case 'str':
            case 'LambdaProperty':
            case 'SymbolicProperty':
                // TODO(later): Treat symbolic expressions with a symbolic
                // parser, they're not just a regular string.
                valProp = [attrTablePutText(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                )];
                break;
            case 'int':
                valProp = [attrTablePutNumber(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                )];
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
                const allowAdding = addDeleteButton;
                attrTablePutDict(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    valMeta, allowAdding
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

                valProp = [attrTablePutList(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    elemMeta
                )];
                break;
            case 'Range':
            case 'SubsetProperty':
                valProp = [attrTablePutRange(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                )];
                break;
            case 'DataProperty':
                valProp = [attrTablePutSelect(
                    key, undefined, val, elem, xform, target, valueCell, dtype,
                    elem ? Object.keys(elem.sdfg.attributes._arrays): []
                )];
                break;
            case 'CodeBlock':
                valProp = [attrTablePutCode(
                    key, undefined, val ? val.string_data : '', elem, xform,
                    target, valueCell, dtype
                )];
                break;
            case 'Array':
            case 'Data':
            case 'Scalar':
            case 'View':
            case 'Reference':
            case 'Stream':
                const containerTypeChoices = Object.keys(
                    sdfgMetaDict['__data_container_types__']
                );
                const dataTypeProp = attrTablePutSelect(
                    key, 'type', val.type, elem, xform, target, valueCell,
                    dtype, containerTypeChoices
                );
                const dataAttrProp = attrTablePutData(
                    key, 'attributes', val, elem, xform, target,
                    valueCell, dtype, meta
                );
                valProp = [dataTypeProp, dataAttrProp];
                break;
            case 'LogicalGroup':
                valProp = [attrTablePutLogicalGroup(
                    key, undefined, val, elem, xform, target, valueCell, dtype
                )];
                break;
            default:
                if (choices !== undefined)
                    valProp = [attrTablePutSelect(
                        key, undefined, val, elem, xform, target, valueCell,
                        dtype, choices
                    )];
                else
                    valueCell.html(sdfg_property_to_string(
                        val, VSCodeRenderer.getInstance()?.view_settings()
                    ));
                break;
        }
    }

    if (updateOnChange && valProp !== undefined) {
        valProp.forEach(prop => {
            if (prop instanceof ValueProperty) {
                if (prop instanceof TypeclassProperty) {
                    prop.getInput().on('typeclass.change', () => {
                        valPropUpdateHandler(prop);
                    });
                } else if (prop instanceof ComboboxProperty) {
                    prop.getInput().on('hidden.editable-select', () => {
                        valPropUpdateHandler(prop);
                    });
                } else {
                    prop.getInput().on('change', () => {
                        valPropUpdateHandler(prop);
                    });
                }
            } else if (prop instanceof CodeProperty) {
                prop.getCodeInput().on('change', () => {
                    valPropUpdateHandler(prop);
                });
                prop.getLangInput().on('change', () => {
                    valPropUpdateHandler(prop);
                });
            }
        });
    }

    if (updateOnChange && keyProp && keyProp.getInput() !== undefined) {
        for (const vProp of valProp ?? [])
            keyProp.connectedProperties.add(vProp);
        keyProp.getInput().on('change', () => {
            if (keyProp)
                keyPropUpdateHandler(keyProp);
        });
    }

    return {
        key: key,
        keyProp: keyProp,
        valProp: valProp,
        deleteBtn: deleteBtn,
        row: row,
    };
}


const ATTR_TABLE_HIDDEN_ATTRIBUTES = [
    'layout',
    'sdfg',
    'sdfg_id',
    'state_id',
    'expr_index',
    'type',
    'transformation',
    'docstring',
    'CATEGORY',
    'is_collapsed',
    'orig_sdfg',
    'position',
    'transformation_hist',
    'symbols',
];


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

    let metadataPromise: any | undefined = undefined;
    if (elem)
        metadataPromise = getElementMetadata(elem);
    else if (xform)
        metadataPromise = getTransformationMetadata(xform);

    metadataPromise.then((metadata: any) => {
        let sortedAttributes: { [key: string]: any } = {};
        Object.keys(attributes).forEach(k => {
            const val = attributes[k];
            if (ATTR_TABLE_HIDDEN_ATTRIBUTES.includes(k) || k.startsWith('_'))
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

        Object.keys(sortedAttributes).forEach(category => {
            if (category === '(Debug)')
                return;
            if (!Object.keys(sortedAttributes[category]).length)
                return;

            const catRow = $('<div>', {
                'class': 'row attr-table-cat-row',
            }).appendTo(root);
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

                // Debug info isn't printed in the attributes table, but instead
                // we show a button to jump to the referenced code location.
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

                const row = $('<div>', {
                    class: 'row attr-table-row',
                }).appendTo(attrTable);
                attributeTablePutEntry(
                    k, val, attrMeta, attributes, elem, xform, row, false,
                    true, false
                );
            });
        });
    });

    // Display a button to jump to the generated C++ code.
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
    } else if (elem instanceof Edge) {
        const jumpToStartBtn = $('#goto-edge-start');
        const jumpToEndBtn = $('#goto-edge-end');
        jumpToStartBtn.on('click', () => {
            elem.setViewToSource(VSCodeRenderer.getInstance()!);
        });
        jumpToEndBtn.on('click', () => {
            elem.setViewToDestination(VSCodeRenderer.getInstance()!);
        });
        jumpToStartBtn.show();
        jumpToEndBtn.show();
    }
}

export function appendSymbolsTable(
    root: JQuery<HTMLElement>, symbols: Record<string, string>, sdfg: JsonSDFG
): void {
    const symbolsTableBaseContainer = $('<div>', {
        'class': 'container-fluid attr-table-base-container',
    }).appendTo(root);

    const catRow = $('<div>', {
        'class': 'row attr-table-cat-row',
    }).appendTo(symbolsTableBaseContainer);
    const catContainer = $('<div>', {
        'class': 'col-12 attr-table-cat-container',
    }).appendTo(catRow);
    const catToggleBtn = $('<button>', {
        'class': 'attr-cat-toggle-btn active',
        'type': 'button',
        'text': 'Symbols',
        'data-bs-toggle': 'collapse',
        'data-bs-target': '#info-table-symbols-containers',
        'aria-expanded': 'false',
        'aria-controls': 'info-table-symbols-containers',
    }).appendTo(catContainer);
    $('<i>', {
        'class': 'attr-cat-toggle-btn-indicator material-icons',
        'text': 'expand_less'
    }).appendTo(catToggleBtn);

    const attrTable = $('<div>', {
        'class': 'container-fluid attr-table collapse show',
        'id': 'info-table-symbols-containers',
    }).appendTo(catContainer);
    attrTable.on('hide.bs.collapse', () => {
        catToggleBtn.removeClass('active');
    });
    attrTable.on('show.bs.collapse', () => {
        catToggleBtn.addClass('active');
    });

    VSCodeSDFV.getInstance().getMetaDict().then(metaDict => {
        const attrMeta = metaDict['__reverse_type_lookup__']['typeclass'];
        for (const symbol in symbols) {
            const symType = symbols[symbol];

            const row = $('<div>', {
                class: 'row attr-table-row',
            }).appendTo(attrTable);
            attributeTablePutEntry(
                symbol, symType, attrMeta, symbols, undefined,
                undefined, row, true, true, true, undefined, undefined, true
            ).then(res => {
                if (res.deleteBtn)
                    res.deleteBtn.on('click', () => {
                        delete symbols[symbol];
                        row.remove();
                        const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                        if (sdfg)
                            vscodeWriteGraph(sdfg);
                    });
            });
        }

        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(attrTable);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add symbol',
            'click': () => {
                const nContModalRet = createSingleUseModal(
                    'New Symbol Name', true, ''
                );

                const nameInput = $('<input>', {
                    type: 'text',
                }).appendTo($('<div>', {
                    class: 'container-fluid',
                }).appendTo(nContModalRet.body));

                nContModalRet.confirmBtn?.on('click', () => {
                    const nameVal = nameInput.val();

                    if (nameVal && nameVal !== '' &&
                        typeof nameVal === 'string') {
                        nContModalRet.modal.modal('hide');

                        const defaultNewType = 'int32';
                        const row = $('<div>', {
                            class: 'row attr-table-row',
                        });
                        addItemButtonRow.before(row);
                        attributeTablePutEntry(
                            nameVal, defaultNewType, attrMeta, symbols,
                            undefined, undefined, row, true, true, true,
                            undefined, undefined, true
                        ).then(newProp => {
                            if (newProp) {
                                if (newProp.deleteBtn)
                                    newProp.deleteBtn.on('click', () => {
                                        if (newProp.key) {
                                            delete symbols[newProp.key];
                                        row.remove();
                                        const sdfg = VSCodeRenderer
                                            .getInstance()?.get_sdfg();
                                        if (sdfg)
                                            vscodeWriteGraph(sdfg);
                                    }
                                });
                            }
                            const sdfg =
                                VSCodeRenderer.getInstance()?.get_sdfg();
                            if (sdfg)
                                vscodeWriteGraph(sdfg);
                        });

                        symbols[nameVal] = defaultNewType;
                    }
                });

                nContModalRet.modal.modal('show');
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(addItemButtonRow));
    });
}

export function appendDataDescriptorTable(
    root: JQuery<HTMLElement>,
    descriptors: { [key: string]: { type: string, attributes: any } },
    sdfg: JsonSDFG
): void {
    const dataTableBaseContainer = $('<div>', {
        'class': 'container-fluid attr-table-base-container',
    }).appendTo(root);

    const catRow = $('<div>', {
        'class': 'row attr-table-cat-row',
    }).appendTo(dataTableBaseContainer);
    const catContainer = $('<div>', {
        'class': 'col-12 attr-table-cat-container',
    }).appendTo(catRow);
    const catToggleBtn = $('<button>', {
        'class': 'attr-cat-toggle-btn active',
        'type': 'button',
        'text': 'Data Containers',
        'data-bs-toggle': 'collapse',
        'data-bs-target': '#info-table-data-containers',
        'aria-expanded': 'false',
        'aria-controls': 'info-table-data-containers',
    }).appendTo(catContainer);
    $('<i>', {
        'class': 'attr-cat-toggle-btn-indicator material-icons',
        'text': 'expand_less'
    }).appendTo(catToggleBtn);

    const attrTable = $('<div>', {
        'class': 'container-fluid attr-table collapse show',
        'id': 'info-table-data-containers',
    }).appendTo(catContainer);
    attrTable.on('hide.bs.collapse', () => {
        catToggleBtn.removeClass('active');
    });
    attrTable.on('show.bs.collapse', () => {
        catToggleBtn.addClass('active');
    });

    VSCodeSDFV.getInstance().getMetaDict().then(metaDict => {
        const updateNameListener = (prop: KeyProperty) => {
            // When a data container name is changed, update the data container
            // and label for all access nodes referencing this data container.
            const nVal = prop.getValue();
            if (nVal.valueChanged) {
                const oldDescriptor = prop.getKey();
                const newDescriptor = nVal.value;

                doForAllNodeTypes(
                    sdfg, 'AccessNode', (accessNode: JsonSDFGNode) => {
                        if (accessNode.attributes?.data ===
                            oldDescriptor) {
                            accessNode.attributes.data = newDescriptor;
                            accessNode.label = newDescriptor;
                        }
                    }, false
                );

                prop.update();

                // Write back the change - this is necessary since we're
                // overwriting the default handler which writes changes back
                // when update-on-value-change is enabled.
                const wholeSdfg =
                    VSCodeRenderer.getInstance()?.get_sdfg();
                if (wholeSdfg)
                    vscodeWriteGraph(wholeSdfg);
            }
        };

        const updateContainerListener = (prop: Property) => {
            // If this is the data container type property, ensure that the data
            // container attributes are updated accordingly (i.e., remove
            // obsolete ones, add default values for new ones).
            const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
            if (!sdfg)
                return;

            if (prop.getSubkey() === 'type') {
                const attrs = descriptors[prop.getKey()]['attributes'];
                const nType = prop.getValue().value;
                const nMeta = metaDict[nType];
                const nMetaKeys = Object.keys(nMeta);
                const oldKeys = Object.keys(attrs);

                // Remove obsolete ones.
                for (const existing of oldKeys) {
                    if (!nMetaKeys.includes(existing))
                        delete attrs[existing];
                }

                // Add the default values for any new ones.
                for (const newKey of nMetaKeys) {
                    if (newKey === 'debuginfo' || newKey === 'metatype')
                        continue;
                    if (!oldKeys.includes(newKey))
                        attrs[newKey] = nMeta[newKey].default;
                }

                // TODO(later): this is an uggly workaround to how the system
                // of filling the info bar currently works. It should instead
                // update the information _without_ re-rendering everything,
                // but at the moment it is difficult to upate all related
                // property keys while making sure none are left over or
                // forgotten. Re-rendering the panel takes care of this for now.
                if (prop.getValue().valueChanged)
                    VSCodeSDFV.getInstance().fillInfo(new SDFG(sdfg));
            }

            if (prop.update())
                vscodeWriteGraph(sdfg);
        };

        for (const descriptor in descriptors) {
            const val = descriptors[descriptor];

            let attrMeta = undefined;
            if (metaDict && metaDict[val.type]) {
                attrMeta = metaDict[val.type];
                attrMeta['metatype'] = val.type;
            }

            const row = $('<div>', {
                class: 'row attr-table-row',
            }).appendTo(attrTable);
            attributeTablePutEntry(
                descriptor, val, attrMeta, descriptors, undefined,
                undefined, row, true, true, true, updateNameListener,
                updateContainerListener, true
            ).then(res => {
                if (res.deleteBtn)
                    res.deleteBtn.on('click', () => {
                        delete descriptors[descriptor];
                        row.remove();
                        const sdfg = VSCodeRenderer.getInstance()?.get_sdfg();
                        if (sdfg)
                            vscodeWriteGraph(sdfg);
                    });
            });
        }

        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(attrTable);
        $('<i>', {
            'class': 'material-icons property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add data container',
            'click': () => {
                const nContModalRet = createSingleUseModal(
                    'New Data Container Name', true, ''
                );

                const nameInput = $('<input>', {
                    type: 'text',
                }).appendTo($('<div>', {
                    class: 'container-fluid',
                }).appendTo(nContModalRet.body));

                nContModalRet.confirmBtn?.on('click', () => {
                    const nameVal = nameInput.val();

                    if (nameVal && nameVal !== '' &&
                        typeof nameVal === 'string') {
                        nContModalRet.modal.modal('hide');

                        const defaultNewType = 'Scalar';
                        const newMetaType = metaDict[defaultNewType];

                        const defaultValues: {
                            type: string,
                            attributes: any,
                        } = {
                            type: defaultNewType,
                            attributes: {},
                        };
                        for (const key in newMetaType) {
                            if (key === 'debuginfo')
                                continue;

                            const val = newMetaType[key];
                            if (Object.keys(val).includes('default'))
                                defaultValues.attributes[key] = val.default;
                        }

                        newMetaType['metatype'] = defaultNewType;

                        const row = $('<div>', {
                            class: 'row attr-table-row',
                        });
                        addItemButtonRow.before(row);
                        attributeTablePutEntry(
                            nameVal, defaultValues, newMetaType, descriptors,
                            undefined, undefined, row, true, true, true,
                            updateNameListener, updateContainerListener, true
                        ).then(newProp => {
                            if (newProp) {
                                if (newProp.deleteBtn)
                                    newProp.deleteBtn.on('click', () => {
                                        if (newProp.key) {
                                            delete descriptors[newProp.key];
                                        row.remove();
                                        const sdfg = VSCodeRenderer
                                            .getInstance()?.get_sdfg();
                                        if (sdfg)
                                            vscodeWriteGraph(sdfg);
                                    }
                                });
                            }
                            const sdfg =
                                VSCodeRenderer.getInstance()?.get_sdfg();
                            if (sdfg)
                                vscodeWriteGraph(sdfg);
                        });

                        descriptors[nameVal] = defaultValues;
                    }
                });

                nContModalRet.modal.modal('show');
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(addItemButtonRow));
    });
}
