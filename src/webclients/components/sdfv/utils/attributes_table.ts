// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    Connector,
    DataSubset,
    Edge,
    JsonSDFG,
    JsonSDFGCodeBlock,
    JsonSDFGDataDesc,
    JsonSDFGSymExpr,
    LibraryNode,
    LogicalGroup,
    SDFG,
    SDFGElement,
    SDFGElementType,
    sdfgPropertyToString,
    SDFGRange,
    State,
} from '@spcl/sdfv/src';
import { editor as monacoEditor } from 'monaco-editor';
import { ComponentTarget } from '../../../../components/components';
import { MetaDictT } from '../../../../types';
import { JsonTransformation } from '../../transformations/transformations';
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
    ValueProperty,
} from '../properties/properties';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';
import {
    createSingleUseModal,
    doForAllNodeTypes,
    getElementMetadata,
    getTransformationMetadata,
    vscodeWriteGraph,
} from './helpers';


export type WithAttributes = JsonSDFGDataDesc | JsonSDFG | SDFGElement;

function updateAttrTable(): void {
    // TODO(later): this is an ugly workaround to how the system of filling the
    // info bar currently works. It should instead update the information
    // _without_ re-rendering everything, but at the moment it is difficult to
    // upate all related property keys while making sure none are left over or
    // forgotten. Re-rendering the panel takes care of this for now.
    const renderer = VSCodeRenderer.getInstance();
    if (renderer?.sdfg) {
        VSCodeSDFV.getInstance().linkedUI.showElementInfo(new SDFG(
            renderer, renderer.ctx, renderer.minimapCtx, renderer.sdfg
        ), renderer);
    }
}

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

function attrTablePutBool(
    key: string, subkey: string | undefined, val: boolean,
    elem: WithAttributes | undefined,
    xform: JsonTransformation | undefined, target: Record<string, unknown>,
    cell: JQuery, dtype: string
): ValueProperty {
    const boolInputContainer = $('<div>', {
        'class': 'form-check form-switch sdfv-property-input ' +
            'sdfv-property-bool',
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

function attrTablePutText(
    key: string, subkey: string | undefined, val: string,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string
): ValueProperty {
    const input = $('<input>', {
        'type': 'text',
        'class': 'sdfv-property-input sdfv-property-text',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

function attrTablePutCode(
    key: string, subkey: string | undefined, val: string,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string
): CodeProperty {
    let lang = 'Python';
    const codeVal = target[key] as JsonSDFGCodeBlock | undefined;
    if (codeVal?.language)
        lang = codeVal.language;

    const container = $('<div>', {
        'class': 'sdfv-property-code-container',
    }).appendTo(cell);

    const input = $('<div>', {
        'class': 'sdfv-property-monaco',
    }).appendTo(container);

    const languageInput = $('<select>', {
        'class': 'sdfv-property-dropdown',
    }).appendTo(container);
    void VSCodeSDFV.getInstance().getMetaDict().then(sdfgMetaDict => {
        const reverseDict =
            sdfgMetaDict.__reverse_type_lookup__ as MetaDictT | undefined;
        const langMeta = reverseDict?.Language as MetaDictT | undefined;
        const languages = (langMeta?.choices ?? []) as string[];
        languages.forEach(l => {
            languageInput.append(new Option(
                l,
                l,
                false,
                l === lang
            ));
        });
    });

    const editor = monacoEditor.create(
        input.get(0)!, {
            value: val,
            language: lang.toLowerCase(),
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

function attrTablePutData(
    key: string, subkey: string | undefined, val: Record<string, unknown>,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string,
    meta?: MetaDictT
): DictProperty {
    const dataCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    const dataEditBtn = $('<i>', {
        'class': 'material-symbols-outlined property-edit-btn',
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
            'class': 'container-fluid attr-table',
        }).appendTo(modal.body);
        void setTableFromAttributes(
            val.attributes as Record<string, unknown>, meta, '', rowbox, false,
            false, false, false,
            elem, xform
        ).then(allProps => {
            for (const nProp of allProps)
                prop.getProperties().push(nProp);

            // If code editors (monaco editors) are part of this dictionary,
            // they need to be resized again as soon as the modal is shown in
            // order to properly fill the container.
            modal.modalElement.on('shown.bs.modal', () => {
                for (const property of prop.getProperties()) {
                    property.valProp?.forEach(vProp => {
                        if (vProp instanceof CodeProperty)
                            vProp.getEditor().layout();
                    });
                }
            });

            if (modal.confirmBtn) {
                modal.confirmBtn.on('click', () => {
                    const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                    if (prop.update() && !xform && sdfg) {
                        updateAttrTable();
                        vscodeWriteGraph(sdfg).catch((reason: unknown) => {
                            console.error('Failed to write SDFG:', reason);
                        });
                    }
                    modal.modal.hide();
                });
            }

            modal.modal.show();
        });
    });

    return prop;
}

function attrTablePutNumber(
    key: string, subkey: string | undefined, val: number,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string
): ValueProperty {
    const input = $('<input>', {
        'type': 'number',
        'class': 'sdfv-property-input sdfv-property-number',
        'value': val,
    }).appendTo(cell);
    return new ValueProperty(elem, xform, target, key, subkey, dtype, input);
}

function attrTablePutSelect(
    key: string, subkey: string | undefined, val: string,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string,
    choices: string[]
): ValueProperty {
    const input = $('<select>', {
        'class': 'sdfv-property-input sdfv-property-dropdown',
    }).appendTo(cell);
    if (!choices.includes(val)) {
        input.append(new Option(
            val,
            val,
            false,
            true
        ));
    }
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
                    elem.sdfg.cfg_list_id,
                    elem.parentStateId,
                    elem.id,
                ];
                void SDFVComponent.getInstance().invoke(
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

function attrTablePutTypeclass(
    key: string, subkey: string | undefined, val: string | { type: string },
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string,
    baseTypes: string[], compoundTypes: Record<string, unknown>
): TypeclassProperty {
    // Add a random string to the id so we can fetch the new element after an
    // editable select is created. Passing the element directly doesn't use the
    // updated fields created by editable select.
    const r = (Math.random() + 1).toString(36).substring(7);
    const input = $('<select>', {
        'id': key + '-' + r + '-typeclass-dropdown',
        'class': 'sdfv-property-input sdfv-property-dropdown',
    }).appendTo(cell);
    const choices = baseTypes.concat(Object.keys(compoundTypes));

    const typeval = val ? (typeof val === 'object' ? val.type : val) : null;
    let found = false;
    for (const array of choices) {
        input.append(new Option(
            array,
            array,
            array === typeval,
            array === typeval
        ));

        if (array === typeval)
            found = true;
    }

    if (!found && typeval)
        input.append(new Option(typeval, typeval, true, true));

    input.editableSelect({
        filter: false,
        effects: 'fade',
        duration: 'fast',
    });

    const editCompoundButton = $('<i>', {
        'class': 'material-symbols-outlined property-edit-btn',
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

function attrTablePutDict(
    key: string, subkey: string | undefined, val: Record<string, unknown>,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string,
    valMeta?: MetaDictT, allowAdding: boolean = true
): DictProperty {
    const dictCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        class: 'sdfv-dict-value-container',
        'html': sdfgPropertyToString(val),
    }).appendTo(dictCellContainer);
    const dictEditBtn = $('<i>', {
        'class': 'material-symbols-outlined property-edit-btn',
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
            'class': 'container-fluid attr-table',
        }).appendTo(modal.body);
        Object.keys(val).forEach(k => {
            const v = val[k];
            const row = $('<div>', {
                class: 'row attr-table-row',
            }).appendTo(rowbox);
            attributeTablePutEntry(
                k, v, valMeta, val, elem, xform, row, true, false, false, true
            ).then(attrProp => {
                if (attrProp.deleteBtn) {
                    attrProp.deleteBtn.on('click', () => {
                        attrProp.keyProp?.getInput().val('');
                        attrProp.keyProp?.markDeleted();
                        attrProp.row.hide();
                    });
                }

                prop.getProperties().push(attrProp);
            }).catch((reason: unknown) => {
                console.error('Failed to add attribute table entry:', reason);
            });
        });

        // If code editors (monaco editors) are part of this dictionary, they
        // need to be resized again as soon as the modal is shown in order to
        // properly fill the container.
        modal.modalElement.on('shown.bs.modal', () => {
            for (const property of prop.getProperties()) {
                property.valProp?.forEach(vProp => {
                    if (vProp instanceof CodeProperty)
                        vProp.getEditor().layout();
                });
            }
        });

        if (allowAdding) {
            const addItemContainer = $('<div>', {
                'class': 'container-fluid',
            }).appendTo(modal.body);
            const addItemButtonRow = $('<div>', {
                'class': 'row',
            }).appendTo(addItemContainer);
            $('<i>', {
                'class': 'material-symbols-outlined property-add-row-btn',
                'text': 'playlist_add',
                'title': 'Add item',
                'click': () => {
                    const row = $('<div>', {
                        class: 'row attr-table-row',
                    }).appendTo(rowbox);
                    let newPropRet: Promise<PropertyEntry>;
                    if (valMeta) {
                        newPropRet = attributeTablePutEntry(
                            '', '', valMeta, val, elem, xform, row, true, false,
                            false, true
                        );
                    } else {
                        newPropRet = attributeTablePutEntry(
                            '', '', { metatype: 'str' }, val, elem, xform, row,
                            true, false, false, true
                        );
                    }
                    void newPropRet.then(newProp => {
                        prop.getProperties().push(newProp);

                        if (newProp.deleteBtn) {
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
        }

        if (modal.confirmBtn) {
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                if (prop.update() && !xform && sdfg) {
                    updateAttrTable();
                    void vscodeWriteGraph(sdfg).then(() => {
                        modal.modal.hide();
                    });
                } else {
                    modal.modal.hide();
                }
            });
        }

        modal.modal.show();
    });

    return prop;
}

function attrTablePutList(
    key: string, subkey: string | undefined, val: unknown[] | undefined,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string,
    elemMeta?: MetaDictT
): ListProperty {
    // If a list's element type is unknown, i.e. there is no element metadata,
    // treat it as a string so it can be edited properly.
    elemMeta ??= { metatype: 'str' };

    const listCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<div>', {
        'html': sdfgPropertyToString(val),
    }).appendTo(listCellContainer);
    const listCellEditBtn = $('<i>', {
        'class': 'material-symbols-outlined property-edit-btn',
        'text': 'edit',
        'title': 'Click to edit',
    }).appendTo(listCellContainer);

    const prop = new ListProperty(
        elem, xform, target, key, subkey, dtype, [], val ?? []
    );

    listCellEditBtn.on('click', () => {
        prop.setPropertiesList([]);

        const modal = createSingleUseModal(
            key, true, 'property-edit-modal-body'
        );

        const valMirrorDict = {} as Record<string, unknown>;

        const rowbox = $('<div>', {
            'class': 'container-fluid attr-table',
        }).appendTo(modal.body);
        if (val) {
            for (let i = 0; i < val.length; i++) {
                const v = val[i];
                valMirrorDict[i.toString()] = v;
                const row = $('<div>', {
                    class: 'row attr-table-row',
                }).appendTo(rowbox);
                attributeTablePutEntry(
                    i.toString(), v, elemMeta, valMirrorDict, elem, xform, row,
                    false, false, false, true
                ).then(attrProp => {
                    if (attrProp.deleteBtn) {
                        attrProp.deleteBtn.on('click', () => {
                            attrProp.valProp?.forEach(vProp => {
                                vProp.markDeleted();
                            });
                            attrProp.row.hide();
                        });
                    }

                    if (attrProp.valProp)
                        prop.getPropertiesList().push(...attrProp.valProp);
                }).catch((reason: unknown) => {
                    console.error(
                        'Failed to add attribute table entry:', reason
                    );
                });
            }

            // If code editors (monaco editors) are part of this list, they
            // need to be resized again as soon as the modal is shown in order
            // to properly fill the container.
            modal.modalElement.on('shown.bs.modal', () => {
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
            'class': 'material-symbols-outlined property-add-row-btn',
            'text': 'playlist_add',
            'title': 'Add item',
            'click': () => {
                const i = prop.getPropertiesList().length;
                const row = $('<div>', {
                    class: 'row attr-table-row',
                }).appendTo(rowbox);
                attributeTablePutEntry(
                    i.toString(), '', elemMeta, valMirrorDict, elem, xform, row,
                    false, false, false, true
                ).then(newProp => {
                    if (newProp.valProp) {
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
                }).catch((reason: unknown) => {
                    console.error(
                        'Failed to add attribute table entry:', reason
                    );
                });
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(AddItemButtonRow));

        if (modal.confirmBtn) {
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                if (prop.update() && !xform && sdfg) {
                    updateAttrTable();
                    vscodeWriteGraph(sdfg).catch((reason: unknown) => {
                        console.error('Failed to write SDFG:', reason);
                    });
                }
                modal.modal.hide();
            });
        }

        modal.modal.show();
    });

    return prop;
}

function attrTablePutRange(
    key: string, subkey: string | undefined, val: SDFGRange | undefined,
    elem: WithAttributes | undefined,
    xform: JsonTransformation | undefined, target: Record<string, unknown>,
    cell: JQuery, dtype: string
): RangeProperty {
    const rangeCellContainer = $('<div>', {
        'class': 'popup-editable-property-container',
    }).appendTo(cell);
    $('<td>', {
        'html': sdfgPropertyToString(val),
    }).appendTo(rangeCellContainer);
    const rangeEditBtn = $('<i>', {
        'class': 'material-symbols-outlined property-edit-btn',
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
            'class': 'container-fluid attr-table',
        }).appendTo(modal.body);
        if (val?.ranges) {
            (val as DataSubset).ranges?.forEach(range => {
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
                    'class': 'material-symbols-outlined ' +
                        'sdfv-property-delete-btn',
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
        }

        const addItemContainer = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);
        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(addItemContainer);
        $('<i>', {
            'class': 'material-symbols-outlined property-add-row-btn',
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
                    'class': 'material-symbols-outlined ' +
                        'sdfv-property-delete-btn',
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

        if (modal.confirmBtn) {
            modal.confirmBtn.on('click', () => {
                const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                if (prop.update() && !xform && sdfg) {
                    updateAttrTable();
                    void vscodeWriteGraph(sdfg).then(() => {
                        modal.modal.hide();
                    });
                } else {
                    modal.modal.hide();
                }
            });
        }

        modal.modal.show();
    });

    return prop;
}

function attrTablePutLogicalGroup(
    key: string, subkey: string | undefined, val: LogicalGroup,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    target: Record<string, unknown>, cell: JQuery, dtype: string
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
    key: string, val: unknown, meta: MetaDictT | undefined,
    target: Record<string, unknown>,
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    row: JQuery, editableKey: boolean,
    updateOnChange: boolean, delayedEdit: boolean, addDeleteButton: boolean,
    isNonDefault: boolean = false,
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
        class: 'container-fluid',
    }).appendTo(contentCell);
    const contentRow = $('<div>', {
        class: 'row',
    }).appendTo(contentCellWrapper);

    let dtype = undefined;
    let choices = undefined;
    if (meta) {
        if (meta.metatype)
            dtype = meta.metatype as string;
        if (meta.choices)
            choices = meta.choices as string[];
    }

    const valPropUpdateHandler =
        valueChangeHandlerOverride ?? ((prop?: Property) => {
            const sdfg = VSCodeRenderer.getInstance()?.sdfg;
            if (prop?.update() && !xform && sdfg) {
                vscodeWriteGraph(sdfg).catch((reason: unknown) => {
                    console.error('Failed to write SDFG:', reason);
                });
            }
        });

    const keyPropUpdateHandler =
        keyChangeHandlerOverride ?? ((prop?: KeyProperty) => {
            const sdfg = VSCodeRenderer.getInstance()?.sdfg;
            if (prop?.update() && !xform && sdfg) {
                vscodeWriteGraph(sdfg).catch((reason: unknown) => {
                    console.error('Failed to write SDFG:', reason);
                });
            }
        });

    let keyCell = undefined;
    if (editableKey && !delayedEdit) {
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

    if (meta?.desc)
        row.attr('title', meta.desc as string);

    if (addDeleteButton) {
        const deleteWrapper = $('<div>', {
            style: 'height: 100%; display: flex; align-items: center;',
        }).appendTo(prefixCell);
        deleteBtn = $('<span>', {
            'class': 'material-symbols-outlined sdfv-property-delete-btn',
            'text': 'remove_circle',
            'title': 'Delete entry',
        }).appendTo(deleteWrapper);
    }

    if (isNonDefault) {
        $('<div>', {
            class: 'attr-changed-bar',
            title: 'This value has been changed from its default',
        }).appendTo(prefixCell);
    }

    const valueCell = $('<div>', {
        'class': 'attr-table-cell ' + (
            invertedSpacing ? 'attr-cell-s' : 'attr-cell-l'
        ),
    }).appendTo(contentRow);
    const valContents = $('<div>', {
        class: 'attr-table-value',
    }).appendTo(valueCell);

    const setValContentsPlain = async () => {
        const sdfgMetaDict = await VSCodeSDFV.getInstance().getMetaDict();
        // Implementations that are set to null should still be visible. Other
        // null properties should be shown as an empty field.
        if (key === 'implementation' && val === null) {
            valContents.text('null');
        } else if (dtype === undefined) {
            valContents.html(sdfgPropertyToString(val));
        } else if (dtype in (sdfgMetaDict.__data_container_types__ ?? {})) {
            let containerLabel = dtype + ' ';
            const valAsRecord = val as Record<string, unknown>;
            if ('attributes' in valAsRecord && valAsRecord.attributes) {
                const attr = valAsRecord.attributes as Record<string, unknown>;
                if (dtype.endsWith('Array') && attr.shape)
                    containerLabel += sdfgPropertyToString(attr.shape);
            }
            $('<div>', {
                class: 'data-container-summary',
                text: containerLabel,
            }).appendTo(valContents);
        } else {
            switch (dtype) {
                default:
                    valContents.html(sdfgPropertyToString(val));
                    break;
            }
        }
    };

    const setValContentsRich = async () => {
        const sdfgMetaDict = await VSCodeSDFV.getInstance().getMetaDict();
        const reverseDict = sdfgMetaDict.__reverse_type_lookup__ ?? {};
        const containerTypes = sdfgMetaDict.__data_container_types__ ?? {};
        switch (dtype) {
            case 'typeclass':
                if (meta?.base_types && meta.compound_types) {
                    valProp = [
                        attrTablePutTypeclass(
                            key, undefined, val as string | { type: string },
                            elem, xform, target, valContents, dtype,
                            meta.base_types as string[],
                            meta.compound_types as Record<string, unknown>
                        ),
                    ];
                }
                break;
            case 'bool':
                valProp = [
                    attrTablePutBool(
                        key, undefined, val as boolean, elem, xform, target,
                        valContents, dtype
                    ),
                ];
                break;
            case 'str':
            case 'LambdaProperty':
            case 'SymbolicProperty':
                // TODO(later): Treat symbolic expressions with a symbolic
                // parser, they're not just a regular string.
                valProp = [
                    attrTablePutText(
                        key, undefined, val as string, elem, xform, target,
                        valContents, dtype
                    ),
                ];
                break;
            case 'int':
                valProp = [
                    attrTablePutNumber(
                        key, undefined, val as number, elem, xform, target,
                        valContents, dtype
                    ),
                ];
                break;
            case 'dict':
                let valType = undefined;
                let valMeta = undefined;
                if (meta?.value_type)
                    valType = meta.value_type as string;
                if (valType && reverseDict[valType])
                    valMeta = reverseDict[valType] as MetaDictT;
                const allowAdding = addDeleteButton;
                attrTablePutDict(
                    key, undefined, val as Record<string, unknown>, elem, xform,
                    target, valContents, dtype, valMeta, allowAdding
                );
                break;
            case 'set':
            case 'list':
            case 'tuple':
                let elemType = undefined;
                let elemMeta = undefined;
                if (meta?.element_type)
                    elemType = meta.element_type as string;
                if (elemType && reverseDict[elemType])
                    elemMeta = reverseDict[elemType] as MetaDictT;
                if (elemMeta === undefined && elemType)
                    elemMeta = { metatype: elemType };

                valProp = [
                    attrTablePutList(
                        key, undefined, val as unknown[], elem, xform, target,
                        valContents, dtype, elemMeta
                    ),
                ];
                break;
            case 'Range':
            case 'SubsetProperty':
                valProp = [
                    attrTablePutRange(
                        key, undefined, val as SDFGRange, elem, xform, target,
                        valContents, dtype
                    ),
                ];
                break;
            case 'DataProperty':
                valProp = [
                    attrTablePutSelect(
                        key, undefined, val as string, elem, xform, target,
                        valContents, dtype, elem ? Object.keys(
                            (elem.sdfg as JsonSDFG).attributes?._arrays ?? {}
                        ): []
                    ),
                ];
                break;
            case 'CodeBlock':
                valProp = [
                    attrTablePutCode(
                        key, undefined,
                        (val as JsonSDFGCodeBlock).string_data ?? '', elem,
                        xform, target, valContents, dtype
                    ),
                ];
                break;
            case 'LogicalGroup':
                valProp = [
                    attrTablePutLogicalGroup(
                        key, undefined, val as LogicalGroup, elem, xform,
                        target, valContents, dtype
                    ),
                ];
                break;
            default:
                if (dtype !== undefined && dtype in containerTypes) {
                    const containerTypeChoices = Object.keys(containerTypes);
                    const dataContainer = $('<div>', {
                        class: 'data-container-editing-container',
                    }).appendTo(valContents);
                    const typeContainer = $('<div>').appendTo(dataContainer);
                    const dataTypeProp = attrTablePutSelect(
                        key, 'type', (val as JsonSDFGDataDesc).type ?? '', elem,
                        xform, target, typeContainer, dtype,
                        containerTypeChoices
                    );
                    const editBtnContainer = $('<div>').appendTo(dataContainer);
                    const dataAttrProp = attrTablePutData(
                        key, 'attributes', val as JsonSDFGDataDesc, elem, xform,
                        target, editBtnContainer, dtype, meta
                    );
                    valProp = [dataTypeProp, dataAttrProp];
                } else {
                    if (choices !== undefined && dtype !== undefined) {
                        valProp = [
                            attrTablePutSelect(
                                key, undefined, val as string, elem, xform,
                                target, valContents, dtype, choices
                            ),
                        ];
                    } else {
                        valContents.html(sdfgPropertyToString(val));
                    }
                }
                break;
        }
        return valProp;
    };

    if (key === 'constants_prop') {
        const constContainer = $('<div>').appendTo(valContents);
        const constProp = val as Record<string, [string, number]>;
        for (const k in constProp) {
            const v = constProp[k];
            constContainer.append($('<div>', {
                text: k + ': ' + v[1].toString(),
            }));
        }
    } else if (dtype === undefined) {
        await setValContentsPlain();
    } else if (delayedEdit) {
        await setValContentsPlain();

        const delayedEditBtnContainer = $('<div>', {
            class: 'value-edit-control',
        }).appendTo(valueCell);

        const delayedEditBtn = $('<i>', {
            class: 'material-symbols-outlined property-edit-btn',
            text: 'edit',
            title: 'Click to edit',
        }).appendTo(delayedEditBtnContainer);

        delayedEditBtn.on('click', () => {
            delayedEditBtn.hide();

            valContents.html('');
            if (editableKey) {
                keyCell.removeClass('attr-table-heading');
                keyCell.html('');
                const keyInput = $('<input>', {
                    'type': 'text',
                    'class': 'property-key-input sdfv-property-text',
                    'value': key,
                }).appendTo(keyCell);
                keyProp = new KeyProperty(elem, xform, target, key, keyInput);
            }

            setValContentsRich().then(valProp => {
                if (valProp === undefined) {
                    // TODO: gracefully fail.
                } else {
                    const delayedEditDiscardBtn = $('<i>', {
                        class: 'material-symbols-outlined property-edit-btn',
                        text: 'close',
                        title: 'Discard change',
                    }).appendTo(delayedEditBtnContainer);
                    const delayedEditAcceptBtn = $('<i>', {
                        class: 'material-symbols-outlined property-edit-btn',
                        text: 'check',
                        title: 'Confirm change',
                    }).appendTo(delayedEditBtnContainer);
                    delayedEditAcceptBtn.on('click', () => {
                        if (keyProp)
                            keyPropUpdateHandler(keyProp);

                        if (editableKey) {
                            keyCell.addClass('attr-table-heading');
                            keyCell.html('');
                            keyCell.text(key);
                        }

                        valProp.forEach(prop => {
                            valPropUpdateHandler(prop);
                        });
                        valContents.html('');
                        setValContentsPlain().then(() => {
                            delayedEditBtn.show();
                            delayedEditAcceptBtn.remove();
                            delayedEditDiscardBtn.remove();
                        }).catch(console.error);
                    });

                    delayedEditDiscardBtn.on('click', () => {
                        if (editableKey) {
                            keyCell.addClass('attr-table-heading');
                            keyCell.html('');
                            keyCell.text(key);
                        }

                        valContents.html('');
                        setValContentsPlain().then(() => {
                            delayedEditBtn.show();
                            delayedEditAcceptBtn.remove();
                            delayedEditDiscardBtn.remove();
                        }).catch(console.error);
                    });
                }
            }).catch(console.error);
        });
    } else {
        valProp = await setValContentsRich();
    }

    if (updateOnChange && !delayedEdit && valProp !== undefined) {
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

    if (updateOnChange && !delayedEdit && keyProp?.getInput() !== undefined) {
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
    'metatype',
];

async function setTableFromAttributes(
    attributes: Record<string, unknown>,
    metadata: MetaDictT | undefined, identifier: string, root: JQuery,
    editableKeys: boolean = false,
    updateOnChange: boolean = false, delayedEdit: boolean = false,
    addDeleteButton: boolean = false, elem?: WithAttributes,
    xform?: JsonTransformation
): Promise<PropertyEntry[]> {
    const propertyEntries: PropertyEntry[] = [];

    const sortedAttributes: Partial<Record<string, Record<string, any>> > = {};
    const handledKeys = new Set<string>();
    for (const k in metadata) {
        const val = metadata[k];
        if (ATTR_TABLE_HIDDEN_ATTRIBUTES.includes(k) || k.startsWith('_'))
            continue;
        sortedAttributes[
            (metadata[k] as MetaDictT).category ?? 'Uncategorized'
        ] ??= {};
        sortedAttributes[
            (metadata[k] as MetaDictT).category ?? 'Uncategorized'
        ]![k] = val;
        handledKeys.add(k);
    }

    for (const k in attributes) {
        if (ATTR_TABLE_HIDDEN_ATTRIBUTES.includes(k) || k.startsWith('_'))
            continue;
        if (!handledKeys.has(k)) {
            sortedAttributes.Uncategorized ??= {};
            sortedAttributes.Uncategorized[k] = attributes[k];
            handledKeys.add(k);
        }
    }

    for (const category in sortedAttributes) {
        if (category === '(Debug)')
            continue;
        if (!Object.keys(sortedAttributes[category]!).length)
            continue;

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
            'class': 'attr-cat-toggle-btn-indicator ' +
                'material-symbols-outlined',
            'text': 'expand_less',
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

        for (const k in sortedAttributes[category]) {
            const isNonDefault = attributes[k] !== undefined;
            const sortedMeta =
                sortedAttributes[category][k] as MetaDictT | undefined;
            const val = isNonDefault ? attributes[k] : sortedMeta?.default;

            // Debug info isn't printed in the attributes table, but instead
            // we show a button to jump to the referenced code location.
            if (k === 'debuginfo') {
                if (val) {
                    const gotoSourceBtn = $('#goto-source-btn');
                    const dbgInfoVal = val as {
                        filename: string;
                        start_line: number;
                        start_column: number;
                        end_line: number;
                        end_column: number;
                    };
                    gotoSourceBtn.on('click', () => {
                        VSCodeSDFV.getInstance().gotoSource(
                            dbgInfoVal.filename,
                            dbgInfoVal.start_line,
                            dbgInfoVal.start_column,
                            dbgInfoVal.end_line,
                            dbgInfoVal.end_column
                        ).catch((reason: unknown) => {
                            console.error(
                                'Failed to jump to source:', reason
                            );
                        });
                    });
                    gotoSourceBtn.prop(
                        'title',
                        dbgInfoVal.filename + ':' +
                        String(dbgInfoVal.start_line)
                    );
                    gotoSourceBtn.show();
                }
                continue;
            }

            let attrMeta = undefined;
            if (metadata?.[k])
                attrMeta = metadata[k] as MetaDictT;

            const row = $('<div>', {
                class: 'row attr-table-row',
            }).appendTo(attrTable);
            const prop = await attributeTablePutEntry(
                k, val, attrMeta, attributes, elem, xform, row, editableKeys,
                updateOnChange, delayedEdit, addDeleteButton, isNonDefault
            );
            propertyEntries.push(prop);
        }
    }

    return propertyEntries;
}

export function generateAttributesTable(
    elem: WithAttributes | undefined, xform: JsonTransformation | undefined,
    root: JQuery
): void {
    let attributes: Record<string, unknown> | undefined = undefined;
    let identifier = '';
    if (elem) {
        if (elem instanceof SDFGElement)
            attributes = elem.attributes();
        else
            attributes = elem.attributes;
        identifier = elem.type ?? 'undefined';
    } else if (xform) {
        attributes = xform;
        identifier = xform.transformation;
    }

    let metaPromise: Promise<MetaDictT>;
    if (elem)
        metaPromise = getElementMetadata(elem);
    else if (xform)
        metaPromise = getTransformationMetadata(xform);
    else
        throw new Error('Either elem or xform must be provided.');

    metaPromise.then(metadata => {
        setTableFromAttributes(
            attributes ?? {}, metadata, identifier, root, false, true, false,
            false, elem, xform
        ).then(() => {
            // Display a button to jump to the generated C++ code.
            if (
                elem instanceof SDFGElement &&
                !(elem instanceof Edge) &&
                !(elem instanceof Connector)
            ) {
                const gotoCppBtn = $('#goto-cpp-btn');
                const undefinedVal = -1;
                const sdfgName =
                    VSCodeRenderer.getInstance()?.sdfg?.attributes?.name ??
                    'program';
                const sdfgId = elem.sdfg.cfg_list_id;
                let stateId = undefinedVal;
                let nodeId = undefinedVal;

                if (elem instanceof State) {
                    stateId = elem.id;
                } else if (elem instanceof Node) {
                    if (elem.parentStateId === undefined)
                        stateId = undefinedVal;
                    else
                        stateId = elem.parentStateId;
                    nodeId = elem.id;
                }

                gotoCppBtn.on('click', () => {
                    VSCodeSDFV.getInstance().gotoCpp(
                        sdfgName,
                        sdfgId,
                        stateId,
                        nodeId
                    ).catch((reason: unknown) => {
                        console.error('Failed to jump to C++ code:', reason);
                    });
                });
                gotoCppBtn.prop(
                    'title',
                    sdfgName + ':' + String(sdfgId) +
                        (stateId === undefinedVal ?
                            '' : (':' + String(stateId)) +
                        (nodeId === undefinedVal ? '' : (':' + String(nodeId))))
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
        }).catch(console.error);
    }).catch(console.error);
}

export function appendSymbolsTable(
    root: JQuery, symbols: Record<string, JsonSDFGSymExpr | string>,
    startExpandedThreshold: number
): void {
    const nSymbols = Object.keys(symbols).length;
    const startExpanded = nSymbols <= startExpandedThreshold;

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
        'class': 'attr-cat-toggle-btn' + (startExpanded ? ' active' : ''),
        'type': 'button',
        'text': 'Symbols (' + nSymbols.toString() + ')',
        'data-bs-toggle': 'collapse',
        'data-bs-target': '#info-table-symbols-container',
        'aria-expanded': 'false',
        'aria-controls': 'info-table-symbols-container',
    }).appendTo(catContainer);
    $('<i>', {
        'class': 'attr-cat-toggle-btn-indicator material-symbols-outlined',
        'text': 'expand_less',
    }).appendTo(catToggleBtn);

    const attrTable = $('<div>', {
        class: 'container-fluid attr-table collapse' + (
            startExpanded ? ' show' : ''
        ),
        id: 'info-table-symbols-container',
    }).appendTo(catContainer);
    attrTable.on('hide.bs.collapse', () => {
        catToggleBtn.removeClass('active');
    });
    attrTable.on('show.bs.collapse', () => {
        catToggleBtn.addClass('active');
    });

    VSCodeSDFV.getInstance().getMetaDict().then(async (metaDict) => {
        const reverseTypes = metaDict.__reverse_type_lookup__ ?? {};
        const attrMeta = reverseTypes.typeclass as MetaDictT | undefined;
        for (const symbol in symbols) {
            const symType = symbols[symbol];

            const row = $('<div>', {
                class: 'row attr-table-row',
            }).appendTo(attrTable);
            const res = await attributeTablePutEntry(
                symbol, symType, attrMeta, symbols, undefined,
                undefined, row, true, false, true, true, false, undefined,
                undefined, true
            );
            if (res.deleteBtn) {
                res.deleteBtn.on('click', () => {
                    delete symbols[symbol];
                    row.remove();
                    const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                    if (sdfg) {
                        vscodeWriteGraph(sdfg).catch((err: unknown) => {
                            console.error(
                                'Error writing graph after symbol deletion:',
                                err
                            );
                        });
                    }
                });
            }
        }

        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(attrTable);
        $('<i>', {
            'class': 'material-symbols-outlined property-add-row-btn',
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
                        nContModalRet.modal.hide();

                        const defaultNewType = 'int32';
                        const row = $('<div>', {
                            class: 'row attr-table-row',
                        });
                        addItemButtonRow.before(row);
                        attributeTablePutEntry(
                            nameVal, defaultNewType, attrMeta, symbols,
                            undefined, undefined, row, true, true, false, true,
                            false, undefined, undefined, true
                        ).then(newProp => {
                            if (newProp.deleteBtn) {
                                newProp.deleteBtn.on('click', () => {
                                    if (newProp.key) {
                                        delete symbols[newProp.key];
                                        row.remove();
                                        const sdfg = VSCodeRenderer
                                            .getInstance()?.sdfg;
                                        if (sdfg) {
                                            vscodeWriteGraph(sdfg).catch(
                                                (err: unknown) => {
                                                    console.error(
                                                        'Error writing graph',
                                                        err
                                                    );
                                                }
                                            );
                                        }
                                    }
                                });
                            }
                            const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                            if (sdfg) {
                                vscodeWriteGraph(sdfg).catch((err: unknown) => {
                                    console.error('Error writing graph', err);
                                });
                            }
                        }).catch((err: unknown) => {
                            console.error(
                                'Error writing graph after symbol addition:',
                                err
                            );
                        });

                        symbols[nameVal] = defaultNewType;
                    }
                });

                nContModalRet.modal.show();
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(addItemButtonRow));
    }).catch(console.error);
}

export function appendDataDescriptorTable(
    root: JQuery,
    descriptors: Record<string, JsonSDFGDataDesc>,
    sdfg: JsonSDFG, startExpandedThreshold: number
): void {
    const nDescriptors = Object.keys(descriptors).length;
    const startExpanded = nDescriptors <= startExpandedThreshold;

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
        'class': 'attr-cat-toggle-btn' + (startExpanded ? ' active' : ''),
        'type': 'button',
        'text': 'Data Containers (' + nDescriptors.toString() + ')',
        'data-bs-toggle': 'collapse',
        'data-bs-target': '#info-table-data-container',
        'aria-expanded': 'false',
        'aria-controls': 'info-table-data-container',
    }).appendTo(catContainer);
    $('<i>', {
        'class': 'attr-cat-toggle-btn-indicator material-symbols-outlined',
        'text': 'expand_less',
    }).appendTo(catToggleBtn);

    const attrTable = $('<div>', {
        'class': 'container-fluid attr-table collapse' + (
            startExpanded ? ' show' : ''
        ),
        'id': 'info-table-data-container',
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
                    sdfg, SDFGElementType.AccessNode, accessNode => {
                        if (accessNode.attributes?.data === oldDescriptor) {
                            accessNode.attributes.data = newDescriptor;
                            accessNode.label = newDescriptor;
                        }
                    }, false
                );

                prop.update();

                // Write back the change - this is necessary since we're
                // overwriting the default handler which writes changes back
                // when update-on-value-change is enabled.
                const wholeSdfg = VSCodeRenderer.getInstance()?.sdfg;
                if (wholeSdfg) {
                    vscodeWriteGraph(wholeSdfg).catch((reason: unknown) => {
                        console.error('Failed to write SDFG:', reason);
                    });
                }
            }
        };

        const updateContainerListener = (prop: Property) => {
            // If this is the data container type property, ensure that the data
            // container attributes are updated accordingly (i.e., remove
            // obsolete ones, add default values for new ones).
            const sdfg = VSCodeRenderer.getInstance()?.sdfg;
            if (!sdfg)
                return;

            if (prop.getSubkey() === 'type') {
                const attrs = descriptors[prop.getKey()].attributes ?? {};
                const nType = prop.getValue().value as string;
                const nMeta = metaDict[nType] as MetaDictT;
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
                    if (!oldKeys.includes(newKey)) {
                        attrs[newKey] = (
                            nMeta[newKey] as MetaDictT | undefined
                        )?.default;
                    }
                }

                if (prop.getValue().valueChanged)
                    updateAttrTable();
            }

            if (prop.update()) {
                vscodeWriteGraph(sdfg).catch((reason: unknown) => {
                    console.error('Failed to write SDFG:', reason);
                });
            }
        };

        for (const descriptor in descriptors) {
            const val = descriptors[descriptor];

            let attrMeta = undefined;
            if (val.type && metaDict[val.type]) {
                attrMeta = metaDict[val.type] as MetaDictT | undefined ?? {};
                attrMeta.metatype = val.type;
            }

            const row = $('<div>', {
                class: 'row attr-table-row',
            }).appendTo(attrTable);
            attributeTablePutEntry(
                descriptor, val, attrMeta, descriptors, undefined,
                undefined, row, true, true, true, true, false,
                updateNameListener, updateContainerListener, true
            ).then(res => {
                if (res.deleteBtn) {
                    res.deleteBtn.on('click', () => {
                        delete descriptors[descriptor];
                        row.remove();
                        const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                        if (sdfg)
                            vscodeWriteGraph(sdfg).catch(console.error);
                    });
                }
            }).catch(console.error);
        }

        const addItemButtonRow = $('<div>', {
            'class': 'row',
        }).appendTo(attrTable);
        $('<i>', {
            'class': 'material-symbols-outlined property-add-row-btn',
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
                        nContModalRet.modal.hide();

                        const defaultNewType = 'Scalar';
                        const newMetaType =
                            metaDict[defaultNewType] as MetaDictT;

                        const defaultValues: {
                            type: string,
                            attributes: Record<string, unknown>,
                        } = {
                            type: defaultNewType,
                            attributes: {},
                        };
                        for (const key in newMetaType) {
                            if (key === 'debuginfo')
                                continue;

                            const val =
                                newMetaType[key] as MetaDictT | undefined ?? {};
                            if (Object.keys(val).includes('default'))
                                defaultValues.attributes[key] = val.default;
                        }

                        newMetaType.metatype = defaultNewType;

                        const row = $('<div>', {
                            class: 'row attr-table-row',
                        });
                        addItemButtonRow.before(row);
                        attributeTablePutEntry(
                            nameVal, defaultValues, newMetaType, descriptors,
                            undefined, undefined, row, true, true, false, true,
                            false, updateNameListener, updateContainerListener,
                            true
                        ).then(async (newProp) => {
                            if (newProp.deleteBtn) {
                                newProp.deleteBtn.on('click', () => {
                                    if (newProp.key) {
                                        delete descriptors[newProp.key];
                                        row.remove();
                                        const sdfg = VSCodeRenderer
                                            .getInstance()?.sdfg;
                                        if (sdfg) {
                                            vscodeWriteGraph(sdfg).catch(
                                                (err: unknown) => {
                                                    console.error(
                                                        'Error writing graph',
                                                        err
                                                    );
                                                }
                                            );
                                        }
                                    }
                                });
                            }
                            const sdfg = VSCodeRenderer.getInstance()?.sdfg;
                            if (sdfg)
                                await vscodeWriteGraph(sdfg);
                        }).catch(console.error);

                        descriptors[nameVal] = defaultValues;
                    }
                });

                nContModalRet.modal.show();
            },
        }).appendTo($('<div>', {
            'class': 'col-2',
        }).appendTo(addItemButtonRow));
    }).catch(console.error);
}
