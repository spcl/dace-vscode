// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class VSCodeRenderer extends daceSDFGRenderer {

    bpIndicator;

    constructor(sdfg, container, on_mouse_event = null, user_transform = null,
        debug_draw = false, background = null) {

        dom_setup();

        super(sdfg, container, on_mouse_event, user_transform,
            debug_draw, background);
    }
}

function dom_setup() {
    $('#search-btn').click(() => {
        if (globals.daceRenderer)
            setTimeout(() => {
                find_in_graph(globals.daceRenderer, globals.daceRenderer.graph, $('#search').val(),
                    $('#search-case')[0].checked);
            }, 1);
    });
    $('#search').on('keydown', (e) => {
        if (e.key == 'Enter' || e.which == 13) {
            if (globals.daceRenderer)
                setTimeout(() => {
                    find_in_graph(globals.daceRenderer, globals.daceRenderer.graph, $('#search').val(),
                        $('#search-case')[0].checked);
                }, 1);
            e.preventDefault();
        }
    });
}
