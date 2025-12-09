// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    DataSubset,
    SDFGRange,
    stringToSDFGTypeclass,
} from '@spcl/sdfv/src';
import { editor } from 'monaco-editor';
import { JsonTransformation } from '../../transformations/transformations';
import { showTransformationDetails } from '../transformation/transformation';
import {
    attributeTablePutEntry,
    type WithAttributes,
} from '../utils/attributes_table';
import { createSingleUseModal, elementUpdateLabel } from '../utils/helpers';
import { VSCodeSDFV } from '../vscode_sdfv';
import { MetaDictT } from '../../../../types';


interface PropertyValueReturn {
    value?: unknown;
    valueChanged: boolean;
}

interface RangeInput {
    start: JQuery;
    end: JQuery;
    tile: JQuery;
    step: JQuery;
}

// Note that this Property class is not an equivalent to SDFG Properties, but
// a more general attribute of SDFG elements in VSCode.
export abstract class Property {

    private _deleted: boolean = false;

    constructor(
        protected element: WithAttributes | undefined,
        protected xform: JsonTransformation | undefined,
        protected target: Partial<Record<string, unknown>>,
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

    protected writeBack(value: unknown): void {
        if (this.subkey !== undefined) {
            if (this.datatype === 'Range' ||
                this.datatype === 'SubsetProperty') {
                if (this.target[this.key]) {
                    (this.target[this.key] as Record<string, unknown>)[
                        this.subkey
                    ] = value;
                } else {
                    this.target[this.key] = {
                        type: 'Range',
                        ranges: value,
                    };
                }
            } else {
                (this.target[this.key] as Record<string, unknown>)[
                    this.subkey
                ] = value;
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

    public getTarget(): Record<string, unknown> {
        return this.target;
    }

    public setKey(nKey: string): void {
        this.key = nKey;
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
    private _connectedProps = new Set<Property>();

    constructor(
        protected element: WithAttributes | undefined,
        protected xform: JsonTransformation | undefined,
        protected target: Record<string, unknown>,
        protected key: string,
        protected input: JQuery
    ) {
    }

    public markDeleted(): void {
        this._deleted = true;
    }

    public get deleted(): boolean {
        return this._deleted;
    }

    public getValue(): { value: string, valueChanged: boolean } {
        const newKey = this.input.val()?.toString() ?? '';
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
            if (propertyDescriptor) {
                Object.defineProperty(
                    this.target,
                    res.value,
                    propertyDescriptor
                );
            }
            delete this.target[this.key];
            this.key = res.value;
            for (const connectedProp of this.connectedProperties)
                connectedProp.setKey(this.key);
        }
        return res.valueChanged;
    }

    public getInput(): JQuery {
        return this.input;
    }

    public getKey(): string {
        return this.key;
    }

    public get connectedProperties(): Set<Property> {
        return this._connectedProps;
    }

}

export class ValueProperty extends Property {

    constructor(
        element: WithAttributes | undefined,
        xform: JsonTransformation | undefined,
        target: Record<string, any>,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected input: JQuery
    ) {
        super(element, xform, target, key, subkey, datatype);
    }

    public getValue(): PropertyValueReturn {
        let value: unknown = this.input.is(':checkbox') ?
            this.input.is(':checked') : this.input.val();

        if (this.datatype === 'LambdaProperty') {
            if (value === '' || value === undefined)
                value = null;
        } else if (this.input.attr('type') === 'number') {
            try {
                if (typeof value === 'string')
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

    public getInput(): JQuery {
        return this.input;
    }

}

export class ComboboxProperty extends ValueProperty {

    constructor(
        element: WithAttributes | undefined,
        xform: JsonTransformation | undefined,
        target: Record<string, any>,
        key: string,
        subkey: string | undefined,
        datatype: string,
        input: JQuery,
        protected backgroundInput: JQuery
    ) {
        super(element, xform, target, key, subkey, datatype, input);
    }

    public getValue(): PropertyValueReturn {
        let originalValue = undefined;

        const subProps = this.target[this.key] as Record<string, any>;
        if (this.subkey !== undefined)
            originalValue = subProps[this.subkey] as unknown;
        else
            originalValue = subProps;

        const value = this.backgroundInput.val();
        return {
            value: value,
            valueChanged: originalValue !== value,
        };
    }

}

export class CodeProperty extends Property {

    constructor(
        element: WithAttributes | undefined,
        xform: JsonTransformation | undefined,
        target: Record<string, any>,
        key: string,
        subkey: string | undefined,
        dtype: string,
        protected codeInput: JQuery,
        protected langInput: JQuery,
        protected editor: editor.ICodeEditor
    ) {
        super(element, xform, target, key, subkey, dtype);
    }

    public getValue(): PropertyValueReturn {
        const codeVal = this.editor.getModel()?.getValue();
        const langVal = this.langInput.val();

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

    public getCodeInput(): JQuery {
        return this.codeInput;
    }

    public getLangInput(): JQuery {
        return this.langInput;
    }

}

export class TypeclassProperty extends ComboboxProperty {

    private compoundEditHandler?: () => void;
    private compoundProp?: DictProperty;
    private compoundValues?: Record<string, unknown>;
    private compoundValueType?: string;

    constructor(
        element: WithAttributes | undefined,
        xform: JsonTransformation | undefined,
        target: Record<string, any>,
        key: string,
        subkey: string | undefined,
        datatype: string,
        input: JQuery,
        backgroundInput: JQuery,
        editCompoundButton: JQuery,
        compoundTypes: Record<string, unknown>
    ) {
        super(
            element, xform, target, key, subkey, datatype, input,
            backgroundInput
        );

        if (target[key] && typeof target[key] === 'object') {
            editCompoundButton.show();
            this.compoundValues = target[key] as Record<string, any>;
            this.compoundValueType = this.compoundValues.type as string;
            this.compoundProp = new DictProperty(
                undefined, undefined, this, 'compoundValues', undefined,
                'dict', [], this.compoundValues
            );
            this.compoundEditHandler = () => {
                if (this.compoundValueType) {
                    this.baseCompoundEditHandler(
                        this.compoundValueType, compoundTypes
                    );
                }
            };
            editCompoundButton.on('click', this.compoundEditHandler);
        } else {
            if (this.compoundEditHandler)
                editCompoundButton.off('click', this.compoundEditHandler);
            editCompoundButton.hide();
            this.compoundValues = undefined;
            this.compoundValueType = undefined;
            this.compoundProp = undefined;
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
                const compoundFields = compoundTypes[
                    val
                ] as Record<string, Record<string, unknown>>;
                for (const key in compoundFields) {
                    const descriptor = compoundFields[key];
                    const defaultVal = descriptor.default;
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
                this.compoundValues = undefined;
                this.compoundProp = undefined;
                editCompoundButton.hide();
                if (this.compoundEditHandler)
                    editCompoundButton.off('click', this.compoundEditHandler);
            }

            input.trigger('typeclass.change');
        });
    }

    private baseCompoundEditHandler(
        val: string, compoundTypes: Record<string, unknown>
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
        const compoundFields = compoundTypes[val] as Record<string, unknown>;
        for (const key in compoundFields) {
            const val = this.compoundValues[key];
            void VSCodeSDFV.getInstance().getMetaDict().then(meta => {
                let valMeta = undefined;
                for (const type in meta.__reverse_type_lookup__)
                    valMeta = meta.__reverse_type_lookup__[type] as MetaDictT;

                const row = $('<div>', {
                    class: 'row attr-table-row',
                }).appendTo(rowbox);
                void attributeTablePutEntry(
                    key, val, valMeta, this.compoundValues ?? {}, undefined,
                    undefined, row, false, false, false, false
                ).then(attrProp => {
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
                this.compoundValues = nVal.value as Record<string, unknown>;
                this.compoundValues.type = this.compoundValueType;
                this.input.trigger('typeclass.change');
            }
            modal.modal.hide();
        });

        modal.modal.show();
    }

    public getValue(): PropertyValueReturn {
        let originalValue = undefined;

        if (this.subkey !== undefined) {
            originalValue = (this.target[this.key] as Record<string, unknown>)[
                this.subkey
            ];
        } else {
            originalValue = this.target[this.key];
        }

        if (this.compoundValues) {
            const value = this.compoundValues;
            return {
                value: value,
                valueChanged: originalValue !== value,
            };
        } else {
            const inputVal = this.backgroundInput.val()?.toString();
            const value =
                inputVal ? stringToSDFGTypeclass(inputVal) : undefined;
            return {
                value: value,
                valueChanged: originalValue !== value,
            };
        }
    }

}

export class ListProperty extends Property {

    constructor(
        element: WithAttributes | undefined,
        xform: JsonTransformation | undefined,
        target: Record<string, any>,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected propertiesList: Property[],
        protected originalValue: any[]
    ) {
        super(element, xform, target, key, subkey, datatype);
    }

    public getValue(): PropertyValueReturn {
        if (!this.propertiesList.length) {
            return {
                value: this.originalValue,
                valueChanged: false,
            };
        }

        const newList = [];
        for (const prop of this.propertiesList) {
            if (!prop.deleted) {
                const res = prop.getValue();
                if (res.value !== undefined && res.value !== '')
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

export interface PropertyEntry {
    key: string | undefined;
    keyProp: KeyProperty | undefined;
    valProp: Property[] | undefined;
    deleteBtn: JQuery | undefined;
    row: JQuery;
};

type DictPropertyList = PropertyEntry[];

export class DictProperty extends Property {

    constructor(
        element: WithAttributes | undefined,
        xform: JsonTransformation | undefined,
        target: Record<string, any>,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected properties: DictPropertyList,
        protected originalValue?: Record<string, any>
    ) {
        super(element, xform, target, key, subkey, datatype);
    }

    public getValue(): PropertyValueReturn {
        if (!this.properties.length) {
            return {
                value: this.originalValue,
                valueChanged: false,
            };
        }

        const newDict: Record<string, any> = {};
        let valueChanged = false;
        this.properties.forEach(prop => {
            if ((prop.keyProp || prop.key) && prop.valProp) {
                let keyRes = undefined;
                if (prop.keyProp && !prop.keyProp.deleted)
                    keyRes = prop.keyProp.getValue();
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
                            const codeVal = vp.getTarget()[
                                vp.getKey()
                            ] as Record<string, unknown>;
                            codeVal[valSubkey] = valRes.value;
                            newDict[keyVal] = codeVal;
                        } else {
                            newDict[keyVal] = valRes.value;
                        }
                    });
                    valueChanged = true;
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
        element: WithAttributes | undefined,
        xform: JsonTransformation | undefined,
        target: Record<string, any>,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected nameInput: JQuery,
        protected colorInput: JQuery
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
        const newDict: Record<string, any> = {};
        let valueChanged = false;

        const subRecord = this.target[this.key] as Record<string, any>;
        for (const key in subRecord) {
            if (key === 'color' || key === 'name')
                continue;

            newDict[key] = subRecord[key] as unknown;
        }

        const nameRet = this.nameProperty.getValue();
        valueChanged = nameRet.valueChanged;
        newDict.name = nameRet.value as string;

        const colorRet = this.colorProperty.getValue();
        valueChanged = valueChanged || colorRet.valueChanged;
        newDict.color = colorRet.value as string;

        if (!('nodes' in newDict))
            newDict.nodes = [];
        if (!('states' in newDict))
            newDict.states = [];
        if (!('type' in newDict))
            newDict.type = 'LogicalGroup';

        return {
            value: newDict.name === '' ? undefined : newDict,
            valueChanged: valueChanged,
        };
    }

    public update(): boolean {
        const res = this.getValue();
        super.writeBack(res.value);
        return res.valueChanged;
    }

    public getNameInput(): JQuery {
        return this.nameInput;
    }

    public getColorInput(): JQuery {
        return this.colorInput;
    }

}

export class RangeProperty extends Property {

    constructor(
        element: WithAttributes | undefined,
        xform: JsonTransformation | undefined,
        target: Record<string, any>,
        key: string,
        subkey: string | undefined,
        datatype: string,
        protected rangeInputList: RangeInput[],
        protected originalValue?: SDFGRange | DataSubset
    ) {
        super(element, xform, target, key, subkey, datatype);
    }

    public getValue(): PropertyValueReturn {
        if (!this.rangeInputList.length) {
            return {
                value: this.originalValue,
                valueChanged: false,
            };
        }

        const newRanges: SDFGRange[] = [];
        for (const rangeInput of this.rangeInputList) {
            const targetRange: SDFGRange = {
                start: String(rangeInput.start.val() ?? ''),
                end: String(rangeInput.end.val() ?? ''),
                tile: String(rangeInput.step.val() ?? ''),
                step: String(rangeInput.tile.val() ?? ''),
            };
            if (targetRange.start === '' && targetRange.end === '' &&
                targetRange.step === '' && targetRange.tile === '')
                continue;
            newRanges.push(targetRange);
        }
        const value = newRanges;
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
