// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class Property {

    constructor (element, target, key, subkey, datatype) {
        this.element = element;
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

        if (this.key === 'label') {
            // If the label was changed, we want to update the renderer graph
            // element label as well.
            if (this.element.data) {
                if (this.element.data.node) {
                    this.element.data.node.label = value;

                    if (this.element instanceof ScopeNode) {
                        // In scope nodes the range is attached.
                        if (this.element instanceof EntryNode) {
                            let exit_elem = find_graph_element_by_uuid(
                                renderer.graph,
                                this.element.sdfg.sdfg_list_id + '/' +
                                this.element.parent_id + '/' +
                                this.element.data.node.scope_exit + '/-1'
                            );
                            if (exit_elem) {
                                this.element.data.node.label =
                                    compute_scope_label(this.element);
                                exit_elem.element.data.node.label =
                                    this.element.data.node.label;
                            }
                        } else if (this.element instanceof ExitNode) {
                            let entry_elem = find_graph_element_by_uuid(
                                renderer.graph,
                                this.element.sdfg.sdfg_list_id + '/' +
                                this.element.parent_id + '/' +
                                this.element.data.node.scope_entry + '/-1'
                            );
                            if (entry_elem) {
                                this.element.data.node.label =
                                    compute_scope_label(entry_elem.element);
                                entry_elem.element.data.node.label =
                                    this.element.data.node.label;
                            }
                        }
                    }
                }
            }
        }
    }

    update() {}

}

class KeyProperty {

    constructor(element, target, key, input) {
        this.element = element;
        this.target = target;
        this.key = key;
        this.input = input;
    }

    get_value() {
        return this.input.val();
    }

    update() {
        const new_key = this.get_value();
        if (new_key !== this.key) {
            Object.defineProperty(
                this.target,
                new_key,
                Object.getOwnPropertyDescriptor(this.target, this.key)
            );
            delete this.target[this.key];
            return true;
        }
        return false;
    }

}

class ValueProperty extends Property {

    constructor(element, target, key, subkey, datatype, input) {
        super(element, target, key, subkey, datatype);

        this.input = input;
    }

    get_value() {
        let value = this.input.is(':checkbox') ?
            this.input.is(':checked') : this.input.val();

        if (this.datatype === 'LambdaProperty') {
            if (value === '' || value === undefined)
                value = null;
        }

        return value;
    }

    update() {
        const value = this.get_value();

        super.write_back(value);
    }

}

class ListProperty extends Property {

    constructor(element, target, key, subkey, datatype, properties_list) {
        super(element, target, key, subkey, datatype);

        this.properties_list = properties_list;
    }

    update() {
        const new_list = [];
        for (let i = 0; i < this.properties_list.length; i++) {
            const val = this.properties_list[i].get_value();
            if (val !== undefined && val !== '')
                new_list.push(val);
        }
        super.write_back(new_list);
    }

}

class DictProperty extends Property {

    constructor(element, target, key, subkey, datatype, properties) {
        super(element, target, key, subkey, datatype);

        this.properties = properties;
    }

    update() {
        const new_dict = {};
        let did_update = false;
        this.properties.forEach(prop => {
            if (prop.key_prop && prop.val_prop) {
                const key = prop.key_prop.get_value();
                const val = prop.val_prop.get_value();
                if (key !== undefined && key !== '') {
                    new_dict[key] = val;
                    did_update = true;
                }
            }
        });
        super.write_back(new_dict);
        return did_update;
    }

}

class RangeProperty extends Property {

    constructor(element, target, key, subkey, datatype, range_input_list) {
        super(element, target, key, subkey, datatype);

        this.range_input_list = range_input_list;
    }

    update() {
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

        super.write_back(new_ranges);
    }

}