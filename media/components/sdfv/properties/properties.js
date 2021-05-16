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
        if (this.subkey !== undefined)
            this.target[this.key][this.subkey] = value;
        else
            this.target[this.key] = value;

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
        //vscode_write_graph(renderer.sdfg);
    }

    update() {}

}

class ValueProperty extends Property {

    constructor(element, target, key, subkey, datatype, input) {
        super(element, target, key, subkey, datatype);

        this.input = input;
    }

    update() {
        let value = this.input.is(':checkbox') ?
            this.input.is(':checked') : this.input.val();

        if (this.datatype === 'LambdaProperty') {
            if (value === '' || value === undefined)
                value = null;
        }

        super.write_back(value);
    }

}

class ListProperty extends Property {

    constructor(element, target, key, subkey, datatype, input_list) {
        super(element, target, key, subkey, datatype);

        this.input_list = input_list;
    }

    update() {
        const new_list = [];
        for (let i = 0; i < this.input_list.length; i++) {
            const list_input = this.input_list[i];
            if (list_input.val() !== '' && list_input !== undefined)
                new_list.push(list_input.val());
        }

        super.write_back(new_list);
    }

}

class DictProperty extends Property {

    constructor(element, target, key, subkey, datatype, input_dicts) {
        super(element, target, key, subkey, datatype);

        this.input_dicts = input_dicts;
    }

    update() {
        const new_dict = {};
        for (let i = 0; i < this.input_dicts.length; i++) {
            const dict_input = this.input_dicts[i];
            if (dict_input.key.val() !== '' &&
                dict_input.key.val() !== undefined) {
                let new_val = null;
                if (dict_input.val.val() !== '' &&
                    dict_input.val.val() !== undefined)
                    new_val = dict_input.val.val();
                new_dict[dict_input.key.val()] = new_val;
            }
        }

        super.write_back(new_dict);
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
            new_ranges.push(target_range);
        }

        super.write_back(new_ranges);
    }

}