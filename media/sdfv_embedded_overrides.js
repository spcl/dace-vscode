/**
 * Set the header/title of the info-box in the embedded view.
 * @param {*} title Title to set
 */
function info_box_set_title(title) {
    $('#info-title').text(title);
}

/**
 * Get the current info-box contents.
 */
function info_box_get_contents() {
    return document.getElementById('info-contents');
}

/**
 * Show the info box and its necessary components.
 */
function info_box_show() {
    $('#info-clear-btn').show();
}

/**
 * Clear the info container and its title.
 * This also hides the clear button again.
 */
function clear_info_box() {
    $('#info-contents').html('');
    $('#info-title').text('');
    $('#info-clear-btn').hide();
}

/**
 * Fill out the info-box of the embedded layout with info about an element.
 * This dynamically builds one or more tables showing all of the relevant info
 * about a given element.
 * @param {*} elem  The element to display info about
 */
function fill_info_embedded(elem) {
    if (elem) {
        document.getElementById('info-title').innerText =
            elem.type() + ' ' + elem.label();

        const contents = $('#info-contents');
        contents.html('');
        if (elem instanceof Edge && elem.data.type === 'Memlet') {
            let sdfg_edge = elem.sdfg.nodes[elem.parent_id].edges[elem.id];
            $('<p>', {
                'class': 'info-subtitle',
                'html': 'Connectors: ' + sdfg_edge.src_connector +
                    ' <i class="material-icons">arrow_forward</i> ' +
                    sdfg_edge.dst_connector,
            }).appendTo(contents);
            $('<hr>').appendTo(contents);
        }

        const attr_table = $('<table>', {
            id: 'sdfg-attribute-table',
            'class': 'info-table',
        }).appendTo(contents);
        const attr_table_header = $('<thead>').appendTo(attr_table);
        const attr_table_header_row = $('<tr>').appendTo(attr_table_header);
        $('<th>', {
            'class': 'key-col',
            'text': 'Attribute',
        }).appendTo(attr_table_header_row);
        $('<th>', {
            'class': 'val-col',
            'text': 'Value',
        }).appendTo(attr_table_header_row);

        const attr_table_body = $('<tbody>').appendTo(attr_table);
        for (const attr of Object.entries(elem.attributes())) {
            if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                attr[0].startsWith('_meta_'))
                continue;
            const val = sdfg_property_to_string(
                attr[1],
                renderer.view_settings()
            );
            if (val === null || val === '')
                continue;
            const row = $('<tr>').appendTo(attr_table_body);
            $('<th>', {
                'class': 'key-col',
                'text': attr[0],
            }).appendTo(row);
            $('<td>', {
                'class': 'val-col',
                'html': val,
            }).appendTo(row);
        }

        // If we're processing an access node, add array information too
        if (elem instanceof AccessNode) {
            const sdfg_array = elem.sdfg.attributes._arrays[
                elem.attributes().data
            ];
            $('<br>').appendTo(contents);
            $('<p>', {
                'class': 'info-subtitle',
                'text': 'Array properties:',
            }).appendTo(contents);

            const array_table = $('<table>', {
                id: 'sdfg-array-table',
                'class': 'info-table',
            }).appendTo(contents);
            const array_table_header = $('<thead>').appendTo(array_table);
            const array_table_header_row =
                $('<tr>').appendTo(array_table_header);
            $('<th>', {
                'class': 'key-col',
                'text': 'Property',
            }).appendTo(array_table_header_row);
            $('<th>', {
                'class': 'val-col',
                'text': 'Value',
            }).appendTo(array_table_header_row);

            const array_table_body = $('<tbody>').appendTo(array_table);
            for (const attr of Object.entries(sdfg_array.attributes)) {
                if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                    attr[0].startsWith('_meta_'))
                    continue;
                const val = sdfg_property_to_string(
                    attr[1],
                    renderer.view_settings()
                );
                if (val === null || val === '')
                    continue;
                const row = $('<tr>').appendTo(array_table_body);
                $('<th>', {
                    'class': 'key-col',
                    'text': attr[0],
                }).appendTo(row);
                $('<td>', {
                    'class': 'val-col',
                    'html': val,
                }).appendTo(row);
            }
        }

        $('#info-clear-button').show();
    } else {
        clear_info_box();
    }
}

// Redefine the standard SDFV sidebar interface with the one for the info-box.
sidebar_set_title = info_box_set_title;
sidebar_show = info_box_show;
sidebar_get_contents = info_box_get_contents;
close_menu = clear_info_box;
// Redefine the standard SDFV element information-display function with the one
// for the embedded layout.
fill_info = fill_info_embedded;