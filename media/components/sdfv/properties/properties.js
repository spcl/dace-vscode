// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class Property {

    constructor (element, xform, target, key, subkey, datatype) {
        this.element = element;
        this.xform = xform;
        this.target = target;
        this.key = key;
        this.subkey = subkey;
        this.datatype = datatype;
    }

    write_back(value) {
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
            element_update_label(this.element, this.target);

        if (this.xform)
            show_transformation_details(this.xform);
    }

    get_value() {}

    update() {}

}

class KeyProperty {
    /* 
     * Note: This does not extend the Property class by design, because it
     * behaves slightly differently.
     * TODO(later): Adapt this in such a way, that it can be made a coherent
     * subclass of Property.
     */

    constructor(element, xform, target, key, input) {
        this.element = element;
        this.xform = xform;
        this.target = target;
        this.key = key;
        this.input = input;
    }

    get_value() {
        const new_key = this.input.val();
        return {
            value: new_key,
            value_changed: new_key !== this.key,
        };
    }

    update() {
        const res = this.get_value();
        if (res.value_changed) {
            Object.defineProperty(
                this.target,
                res.value,
                Object.getOwnPropertyDescriptor(this.target, this.key)
            );
            delete this.target[this.key];
        }
        return res.value_changed;
    }

}

class ValueProperty extends Property {

    constructor(element, xform, target, key, subkey, datatype, input) {
        super(element, xform, target, key, subkey, datatype);

        this.input = input;
    }

    get_value() {
        let value = this.input.is(':checkbox') ?
            this.input.is(':checked') : this.input.val();

        if (this.datatype === 'LambdaProperty') {
            if (value === '' || value === undefined)
                value = null;
        }

        return {
            value: value,
            value_changed: true,
        };
    }

    update() {
        const res = this.get_value();
        super.write_back(res.value);
        return res.value_changed;
    }

}

class CodeProperty extends Property {

    constructor(
        element, xform, target, key, subkey, dtype, code_input, lang_input
    ) {
        super(element, xform, target, key, subkey, dtype);

        this.code_input = code_input;
        this.lang_input = lang_input;
    }

    get_value() {
        let code_val = this.code_input.val();
        let lang_val = this.lang_input.val();

        return {
            value: {
                string_data: code_val,
                language: lang_val,
            },
            value_changed: true,
        };
    }

    update() {
        const res = this.get_value();
        super.write_back(res.value);
        return res.value_changed;
    }

}

class TypeclassProperty extends Property {

    constructor(element, xform, target, key, subkey, datatype, input) {
        super(element, xform, target, key, subkey, datatype);

        this.input = input;
    }

    get_value() {
        return {
            value: daceStringToSDFGTypeclass(this.input.val()),
            value_changed: true,
        };
    }

    update() {
        const res = this.get_value();
        super.write_back(res.value);
        return res.value_changed;
    }

}

class ListProperty extends Property {

    constructor(
        element, xform, target, key, subkey, datatype, properties_list
    ) {
        super(element, xform, target, key, subkey, datatype);

        this.properties_list = properties_list;
    }

    get_value() {
        const new_list = [];
        for (let i = 0; i < this.properties_list.length; i++) {
            const res = this.properties_list[i].get_value();
            if (res !== undefined && res.value !== undefined &&
                res.value !== '')
                new_list.push(res.value);
        }
        return {
            value: new_list,
            value_changed: true,
        };
    }

    update() {
        const res = this.get_value();
        super.write_back(res.value);
        return res.value_changed;
    }

}

class DictProperty extends Property {

    constructor(element, xform, target, key, subkey, datatype, properties) {
        super(element, xform, target, key, subkey, datatype);

        this.properties = properties;
    }

    get_value() {
        const new_dict = {};
        let value_changed = false;
        this.properties.forEach(prop => {
            if (prop.key_prop && prop.val_prop) {
                const key_res = prop.key_prop.get_value();
                const val_res = prop.val_prop.get_value();
                if (key_res !== undefined && key_res.value !== undefined &&
                    key_res.value !== '') {
                    if (prop.val_prop.datatype === 'CodeBlock' &&
                        prop.val_prop.subkey !== undefined) {
                        // For code properties, we need to write back the entire
                        // code property structure, including language info.
                        let code_val = prop.val_prop.target[prop.val_prop.key];
                        code_val[prop.val_prop.subkey] = val_res.value;
                        new_dict[key_res.value] = code_val;
                    } else {
                        new_dict[key_res.value] = val_res.value;
                    }
                    value_changed = true;
                }
            }
        });
        return {
            value: new_dict,
            value_changed: value_changed,
        };
    }

    update() {
        const res = this.get_value();
        super.write_back(res.value);
        return res.value_changed;
    }

}

class RangeProperty extends Property {

    constructor(
        element, xform, target, key, subkey, datatype, range_input_list
    ) {
        super(element, xform, target, key, subkey, datatype);

        this.range_input_list = range_input_list;
    }

    get_value() {
        let new_ranges = [];
        for (let i = 0; i < this.range_input_list.length; i++) {
            let target_range = {};
            let range_input = this.range_input_list[i];
            target_range.start = range_input.start.val();
            target_range.end = range_input.end.val();
            target_range.step = range_input.step.val();
            target_range.tile = range_input.tile.val();
            if (target_range.start === '' && target_range.end === '' &&
                target_range.step === '' && target_range.tile === '')
                continue;
            new_ranges.push(target_range);
        }
        let value = new_ranges;
        return {
            value: value,
            value_changed: true,
        };
    }

    update() {
        const res = this.get_value();
        super.write_back(res.value);
        return res.value_changed;
    }

}