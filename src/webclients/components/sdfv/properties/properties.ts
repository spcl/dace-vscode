// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { string_to_sdfg_typeclass } from '@spcl/sdfv/src';
import { editor } from 'monaco-editor';
import { Range } from '../../../../types';
import { showTransformationDetails } from '../transformation/transformation';
import { attributeTablePutEntry } from '../utils/attributes_table';
import { createSingleUseModal, elementUpdateLabel } from '../utils/helpers';
import { VSCodeSDFV } from '../vscode_sdfv';

type PropertyValueReturn = {
    value: any,
    valueChanged: boolean,
};

type RangeInput = {
    start: JQuery<HTMLElement>,
    end: JQuery<HTMLElement>,
    tile: JQuery<HTMLElement>,
    step: JQuery<HTMLElement>,
};

// Note that this Property class is not an equivalent to SDFG Properties, but
// a more general attribute of SDFG elements in VSCode.
export abstract class Property {

    private _deleted: boolean = false;

    constructor (
        protected element: any | undefined,
        protected xform: any | undefined,
        protected target: any,
        protected key: string,
        protected subkey: string | undefined,
        protected datatype: string
    ) {
    }

    public markDeleted(): void {
        this._deleted = true;
    }

    public get deleted(): boolean {
        return this._deleted;
    }

    protected writeBack(value: any): void {
        if (this.subkey !== undefined) {
            if (this.datatype === 'Range' ||
                this.datatype === 'SubsetProperty') {
                if (this.target[this.key])
                    this.target[this.key][this.subkey] = value;
                else
                    this.target[this.key] = {
                        type: 'Range',
                        ranges: value,
                    };
            } else {
                this.target[this.key][this.subkey] = value;
            }
        } else {
            this.target[this.key] = value;
        }

        // Update the element label if it has one and this property belongs to
        // an SDFG element.
        if (this.element)
            elementUpdateLabel(this.element, this.target);

        if (this.xform)
            showTransformationDetails(this.xform);
    }

    public abstract getValue(): PropertyValueReturn;

    public abstract update(): boolean;

    public getDatatype(): string {
        return this.datatype;
    }

    public getKey(): string {
        return this.key;
    }

    public getSubkey(): string | undefined {
        return this.subkey;
    }

    public getTarget(): any {
        return this.target;
    }

}

export class KeyProperty {
    /*
     * Note: This does not extend the Property class by design, because it
     * behaves slightly differently.
     * TODO(later): Adapt this in such a way, that it can be made a coherent
     * subclass of Property.
     */

    private _deleted: boolean = false;

    constructor(
        protected element: any | undefined,
        protected xform: any | undefined,
        protected target: any,
        protected key: string,
        protected input: JQuery<HTMLElement>
    ) {
    }

    public markDeleted(): void {
        this._deleted = true;
    }

    public get deleted(): boolean {
        return this._deleted;
    }

    public getValue(): { value: any, valueChanged: boolean } {
        const newKey = this.input.val();
        return {
            value: newKey,
            valueChanged: newKey !== this.key,
        };
    }

    public update(): boolean {
        const res = this.getValue();
        if (res.valueChanged) {
            const propertyDescriptor = Object.getOwnPropertyDescriptor(
                this.target, this.key
            );
            if (propertyDescriptor)
                Object.defineProperty(
                    this.target,
                    res.value,
                    propertyDescriptor
                );
            delete this.target[this.key];
            this.key = res.value;
        }
        return res.valueChanged;
    }

    public getInput(): JQuery<HTMLElement> {
        return this.input;
    }

    public getKey(): string {
        return this.key;
    }

}

export class ValueProperty extends Property {

    constructor(
        element: any | undefined,
        xform: any | undefined,
        target: any,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected input: JQuery<HTMLElement>
    ) {
        super(element, xform, target, key, subkey, datatype);
    }

    public getValue(): PropertyValueReturn {
        let value: any = this.input.is(':checkbox') ?
            this.input.is(':checked') : this.input.val();

        if (this.datatype === 'LambdaProperty') {
            if (value === '' || value === undefined)
                value = null;
        } else if (this.input.attr('type') === 'number') {
            try {
                value = parseInt(value);
            } catch {
                // ignored.
            }
        }

        return {
            value: value,
            valueChanged: true,
        };
    }

    public update(): boolean {
        const res = this.getValue();
        super.writeBack(res.value);
        return res.valueChanged;
    }

    public getInput(): JQuery<HTMLElement> {
        return this.input;
    }

}

export class ComboboxProperty extends ValueProperty {

    constructor (
        element: any | undefined,
        xform: any | undefined,
        target: any,
        key: string,
        subkey: string | undefined,
        datatype: string,
        input: JQuery<HTMLElement>,
        protected backgroundInput: JQuery<HTMLElement>
    ) {
        super(element, xform, target, key, subkey, datatype, input);
    }

    public getValue(): PropertyValueReturn {
        let originalValue = undefined;

        if (this.subkey !== undefined)
            originalValue = this.target[this.key][this.subkey];
        else
            originalValue = this.target[this.key];

        const value = this.backgroundInput.val();
        return {
            value: value,
            valueChanged: originalValue !== value,
        };
    }

}

export class CodeProperty extends Property {

    constructor(
        element: any | undefined,
        xform: any | undefined,
        target: any,
        key: string,
        subkey: string | undefined,
        dtype: string,
        protected codeInput: JQuery<HTMLElement>,
        protected langInput: JQuery<HTMLElement>,
        protected editor: editor.ICodeEditor
    ) {
        super(element, xform, target, key, subkey, dtype);
    }

    public getValue(): PropertyValueReturn {
        let codeVal = this.editor.getModel()?.getValue();
        let langVal = this.langInput.val();

        return {
            value: {
                string_data: codeVal,
                language: langVal,
            },
            valueChanged: true,
        };
    }

    public update(): boolean {
        const res = this.getValue();
        super.writeBack(res.value);
        return res.valueChanged;
    }

    public getEditor(): editor.ICodeEditor {
        return this.editor;
    }

    public getCodeInput(): JQuery<HTMLElement> {
        return this.codeInput;
    }

    public getLangInput(): JQuery<HTMLElement> {
        return this.langInput;
    }

}

export class TypeclassProperty extends ComboboxProperty {

    private compoundEditHandler?: () => void;
    private compoundProp: DictProperty | null = null;
    private compoundValues: { [keys: string]: any } | null = null;
    private compoundValueType: string | null = null;

    constructor(
        element: any | undefined,
        xform: any | undefined,
        target: any,
        key: string,
        subkey: string | undefined,
        datatype: string,
        input: JQuery<HTMLElement>,
        backgroundInput: JQuery<HTMLElement>,
        editCompoundButton: JQuery<HTMLElement>,
        compoundTypes: { [keys: string]: any }
    ) {
        super(
            element, xform, target, key, subkey, datatype, input,
            backgroundInput
        );

        if (target[key] && typeof target[key] === 'object') {
            editCompoundButton.show();
            this.compoundValueType = target[key]['type'];
            this.compoundValues = target[key];
            this.compoundProp = new DictProperty(
                undefined, undefined, this, 'compoundValues', undefined,
                'dict', [], this.compoundValues
            );
            this.compoundEditHandler = () => {
                if (this.compoundValueType)
                    this.baseCompoundEditHandler(
                        this.compoundValueType, compoundTypes
                    );
            };
            editCompoundButton.on('click', this.compoundEditHandler);
        } else {
            if (this.compoundEditHandler)
                editCompoundButton.off('click', this.compoundEditHandler);
            editCompoundButton.hide();
            this.compoundValues = null;
            this.compoundValueType = null;
            this.compoundProp = null;
        }

        input.on('hidden.editable-select', () => {
            const val = backgroundInput.val();
            if (val === undefined || typeof val !== 'string')
                return;

            if (Object.keys(compoundTypes).includes(val)) {
                // This is a compound type, make the compound edit button
                // available.
                editCompoundButton.show();

                // If a previous edit button handler exists, deregister it.
                if (this.compoundEditHandler)
                    editCompoundButton.off('click', this.compoundEditHandler);

                this.compoundValues = {
                    'type': val,
                };
                this.compoundValueType = val;
                const compoundFields = compoundTypes[val];
                for (const key in compoundFields) {
                    const descriptor = compoundFields[key];
                    const defaultVal = descriptor['default'];
                    this.compoundValues[key] = defaultVal;
                }

                this.compoundProp = new DictProperty(
                    undefined, undefined, this, 'compoundValues', undefined,
                    'dict', [], this.compoundValues
                );

                // Register the new handler.
                this.compoundEditHandler = () => {
                    this.baseCompoundEditHandler(val, compoundTypes);
                };
                editCompoundButton.on('click', this.compoundEditHandler);
            } else {
                // This is a base type, hide the edit button.
                this.compoundValues = null;
                this.compoundProp = null;
                editCompoundButton.hide();
                if (this.compoundEditHandler)
                    editCompoundButton.off('click', this.compoundEditHandler);
            }

            input.trigger('typeclass.change');
        });
    }

    private baseCompoundEditHandler(
        val: string, compoundTypes: { [keys: string]: any }
    ): void {
        if (!this.compoundValues)
            return;

        // Construct and show a modal to edit compound types.
        const modal = createSingleUseModal(
            'Edit ' + val, true, 'property-edit-modal-body'
        );
        const rowbox = $('<div>', {
            'class': 'container-fluid',
        }).appendTo(modal.body);

        // Print an entry for each attribute of the compound.
        const compoundFields = compoundTypes[val];
        for (const key in compoundFields) {
            const descriptor = compoundFields[key];
            const type = descriptor['type'];

            const val = this.compoundValues[key];
            VSCodeSDFV.getInstance().getMetaDict().then(meta => {
                let valMeta = undefined;
                if (type in meta['__reverse_type_lookup__'])
                    valMeta = meta['__reverse_type_lookup__'][type];

                const row = $('<div>', {
                    class: 'row attr-table-row',
                }).appendTo(rowbox);
                attributeTablePutEntry(
                    key, val, valMeta, this.compoundValues, undefined,
                    undefined, row, false, false, false
                ).then(attrProp => {
                    if (attrProp)
                        this.compoundProp?.getProperties().push(attrProp);
                });
            });
        }

        // When the confirm button is clicked, transfer the new values from the
        // modal to the compoundValues intermediate storage and fire the change
        // event. This will then write values back if auto-writeback is active.
        modal.confirmBtn?.on('click', () => {
            const nVal = this.compoundProp?.getValue();
            if (nVal && nVal.valueChanged && nVal.value) {
                this.compoundValues = nVal.value;
                if (this.compoundValues)
                    this.compoundValues['type'] = this.compoundValueType;
                this.input.trigger('typeclass.change');
            }
            modal.modal.modal('hide');
        });

        modal.modal.modal('show');
    }

    public getValue(): PropertyValueReturn {
        let originalValue = undefined;

        if (this.subkey !== undefined)
            originalValue = this.target[this.key][this.subkey];
        else
            originalValue = this.target[this.key];

        if (this.compoundValues) {
            const value = this.compoundValues;
            return {
                value: value,
                valueChanged: originalValue !== value,
            };
        } else {
            const inputVal = this.backgroundInput.val()?.toString();
            const value =
                inputVal ? string_to_sdfg_typeclass(inputVal) : undefined;
            return {
                value: value,
                valueChanged: originalValue !== value,
            };
        }
    }

}

export class ListProperty extends Property {

    constructor(
        element: any | undefined,
        xform: any | undefined,
        target: any,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected propertiesList: Property[],
        protected originalValue: any
    ) {
        super(element, xform, target, key, subkey, datatype);
    }

    public getValue(): PropertyValueReturn {
        if (!this.propertiesList.length)
            return {
                value: this.originalValue,
                valueChanged: false,
            };

        const newList = [];
        for (let i = 0; i < this.propertiesList.length; i++) {
            if (!this.propertiesList[i].deleted) {
                const res = this.propertiesList[i].getValue();
                if (res !== undefined && res.value !== undefined &&
                    res.value !== '')
                    newList.push(res.value);
            }
        }
        return {
            value: newList,
            valueChanged: true,
        };
    }

    public update(): boolean {
        const res = this.getValue();
        super.writeBack(res.value);
        return res.valueChanged;
    }

    public getPropertiesList(): Property[] {
        return this.propertiesList;
    }

    public setPropertiesList(propertiesList: Property[]): void {
        this.propertiesList = propertiesList;
    }

}

export type PropertyEntry = {
    key: string | undefined,
    keyProp: KeyProperty | undefined,
    valProp: Property[] | undefined,
    deleteBtn: JQuery<HTMLElement> | undefined,
    row: JQuery<HTMLElement>,
};

type DictPropertyList = PropertyEntry[];

export class DictProperty extends Property {

    constructor(
        element: any | undefined,
        xform: any | undefined,
        target: any,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected properties: DictPropertyList,
        protected originalValue: any
    ) {
        super(element, xform, target, key, subkey, datatype);
    }

    public getValue(): PropertyValueReturn {
        if (!this.properties.length)
            return {
                value: this.originalValue,
                valueChanged: false,
            };

        const newDict: { [key: string]: any } = {};
        let valueChanged = false;
        this.properties.forEach(prop => {
            if ((prop.keyProp || prop.key) && prop.valProp) {
                if (prop.keyProp && !prop.keyProp.deleted) {
                    const keyRes = prop.keyProp.getValue();
                    let keyVal = keyRes?.value;
                    if (!keyVal || keyVal === '')
                        keyVal = prop.key;
                    if (keyVal !== undefined && keyVal !== '') {
                        prop.valProp.forEach(vp => {
                            const valRes = vp.getValue();
                            const valSubkey = vp.getSubkey();
                            if (vp.getDatatype() === 'CodeBlock' &&
                                valSubkey !== undefined) {
                                // For code properties, we need to write back
                                // the entire code property structure, including
                                // language info.
                                let codeVal = vp.getTarget()[vp.getKey()];
                                codeVal[valSubkey] = valRes.value;
                                newDict[keyVal] = codeVal;
                            } else {
                                newDict[keyVal] = valRes.value;
                            }
                        });
                        valueChanged = true;
                    }
                }
            }
        });
        return {
            value: newDict,
            valueChanged: valueChanged,
        };
    }

    public update(): boolean {
        const res = this.getValue();
        super.writeBack(res.value);
        return res.valueChanged;
    }

    public getProperties(): DictPropertyList {
        return this.properties;
    }

    public setProperties(properties: DictPropertyList): void {
        this.properties = properties;
    }

}

export class LogicalGroupProperty extends Property {

    private readonly nameProperty: ValueProperty;
    private readonly colorProperty: ValueProperty;

    constructor(
        element: any | undefined,
        xform: any | undefined,
        target: any,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected nameInput: JQuery<HTMLElement>,
        protected colorInput: JQuery<HTMLElement>,
    ) {
        super(element, xform, target, key, subkey, datatype);

        this.nameProperty = new ValueProperty(
            element, xform, target, key, 'name', 'string', nameInput
        );
        this.colorProperty = new ValueProperty(
            element, xform, target, key, 'color', 'string', colorInput
        );
    }

    public getValue(): PropertyValueReturn {
        const newDict: { [key: string]: any } = {};
        let valueChanged = false;

        for (const key in this.target[this.key]) {
            if (key === 'color' || key === 'name')
                continue;

            newDict[key] = this.target[this.key][key];
        }

        const nameRet = this.nameProperty.getValue();
        valueChanged = valueChanged || nameRet.valueChanged;
        newDict['name'] = nameRet.value;

        const colorRet = this.colorProperty.getValue();
        valueChanged = valueChanged || colorRet.valueChanged;
        newDict['color'] = colorRet.value;

        if (!('nodes' in newDict))
            newDict['nodes'] = [];
        if (!('states' in newDict))
            newDict['states'] = [];
        if (!('type' in newDict))
            newDict['type'] = 'LogicalGroup';

        return {
            value: newDict['name'] === '' ? undefined : newDict,
            valueChanged: valueChanged,
        };
    }

    public update(): boolean {
        const res = this.getValue();
        super.writeBack(res.value);
        return res.valueChanged;
    }

    public getNameInput(): JQuery<HTMLElement> {
        return this.nameInput;
    }

    public getColorInput(): JQuery<HTMLElement> {
        return this.colorInput;
    }

}

export class RangeProperty extends Property {

    constructor(
        element: any | undefined,
        xform: any | undefined,
        target: any,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected rangeInputList: RangeInput[],
        protected originalValue: any
    ) {
        super(element, xform, target, key, subkey, datatype);
    }

    public getValue(): PropertyValueReturn {
        if (!this.rangeInputList.length)
            return {
                value: this.originalValue,
                valueChanged: false,
            };

        let newRanges: Range[] = [];
        for (let i = 0; i < this.rangeInputList.length; i++) {
            let targetRange: Range = {
                start: null,
                end: null,
                tile: null,
                step: null,
            };
            let rangeInput = this.rangeInputList[i];
            targetRange.start = rangeInput.start.val();
            targetRange.end = rangeInput.end.val();
            targetRange.step = rangeInput.step.val();
            targetRange.tile = rangeInput.tile.val();
            if (targetRange.start === '' && targetRange.end === '' &&
                targetRange.step === '' && targetRange.tile === '')
                continue;
            newRanges.push(targetRange);
        }
        let value = newRanges;
        return {
            value: value,
            valueChanged: true,
        };
    }

    public update(): boolean {
        const res = this.getValue();
        super.writeBack(res.value);
        return res.valueChanged;
    }

    public getRangeInputList(): RangeInput[] {
        return this.rangeInputList;
    }

    public setRangeInputList(rangeInputList: RangeInput[]): void {
        this.rangeInputList = rangeInputList;
    }

}
