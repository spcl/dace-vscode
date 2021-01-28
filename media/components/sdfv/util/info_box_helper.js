
/**
 * Add attribute to attribute table body.
 * 
 * @param {*} attr              the attribute that is added
 * @param {*} attr_table_body   the body where the attribute is added
 * @param {*} elem              the element that is shown in the info box
 * 
 * @returns true if the element has been added, false otherwise
 */
function add_attr_interactive(attr, attr_table_body, elem) {
    switch (attr[0]) {
        case 'instrument':
            if (window.instruments) {
                let options = window.instruments.map(el => new Option(el, el, false, el === attr[1]));

                let apply_change = (event) => {
                    let val = window.instruments[event.target.selectedIndex];
                    if (elem && elem.data) {
                        if (elem.data.attributes)
                            elem.data.attributes.instrument = val;
                        else if (elem.data.state)
                            elem.data.state.attributes.instrument = val;
                        else if (elem.data.node)
                            elem.data.node.attributes.instrument = val;
                        renderer.send_new_sdfg_to_vscode();
                    }
                };

                add_dropdown(attr[0], attr_table_body, options, apply_change);
            } else {
                // If the available instruments aren't set yet, try to
                // get them from DaCe.
                vscode.postMessage({
                    type: 'dace.get_enum',
                    name: 'InstrumentationType',
                });
            }
            return true;
        case 'access':
            if (window.access) {
                let options = window.access.map(el => new Option(el, el, false, el === attr[1]));

                let apply_change = (event) => {
                    let val = window.access[event.target.selectedIndex];
                    if (elem?.data?.node?.attributes) {
                        elem.data.node.attributes.access = val;
                        renderer.send_new_sdfg_to_vscode();
                    }
                };

                add_dropdown(attr[0], attr_table_body, options, apply_change);
            } else {
                // If the access types are not set, then get it from DaCe
                vscode.postMessage({
                    type: 'dace.get_enum',
                    name: 'AccessType',
                });
            }
            return true;
        case 'setzero':
            add_boolean_dropdown(attr[0], attr_table_body, elem.data.node.attributes, attr[0]);
            return true;
        default:
            return false;
    }
}

function add_boolean_dropdown(text, body, elem, attr) {
    let options = [
        new Option('True', true, false, elem[attr]),
        new Option('False', false, false, !elem[attr])
    ];
    let apply_change = (event) => {
        elem[attr] = event.target.selectedIndex == 0;
        renderer.send_new_sdfg_to_vscode();
    }

    add_dropdown(text, body, options, apply_change);
}

function add_dropdown(text, body, options, apply_change) {
    const row = $('<tr>').appendTo(body);
    $('<th>', {
        'class': 'key-col',
        'text': text,
    }).appendTo(row);
    const cell = $('<td>', {
        'class': 'val-col',
    }).appendTo(row);

    const select = $('<select>', {
        'name': text,
        'class': 'sdfv-property-dropdown',
    }).appendTo(cell);

    select.change(apply_change);

    options.forEach(option => select.append(option));
}