// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class VSCodeRenderer extends daceSDFGRenderer {

    bpIndicator;

    constructor(sdfg, container, on_mouse_event = null, user_transform = null,
        debug_draw = false, background = null, mode_buttons = null) {

        dom_setup();

        if (!mode_buttons) {
            let pan_btn = document.getElementById('pan-btn');
            let move_btn = document.getElementById('move-btn');
            let select_btn = document.getElementById('select-btn');
            let add_btns = [
                document.getElementById('elem_map'),
                document.getElementById('elem_consume'),
                document.getElementById('elem_tasklet'),
                document.getElementById('elem_nested_sdfg'),
                document.getElementById('elem_access_node'),
                document.getElementById('elem_stream'),
                document.getElementById('elem_state'),
            ];
            if (pan_btn)
                mode_buttons = {
                    pan: pan_btn,
                    move: move_btn,
                    select: select_btn,
                    add_btns: add_btns
                };
        }

        super(sdfg, container, on_mouse_event, user_transform,
            debug_draw, background, mode_buttons);

        this.bpIndicator = new BreakpointIndicator(this);
    }

    draw(dt) {
        super.draw(dt);
        this.bpIndicator.draw();
    }

    on_mouse_event(event, comp_x_func, comp_y_func, evtype = 'other') {
        super.on_mouse_event(event, comp_x_func, comp_y_func, evtype);
        this.bpIndicator.handle_mouse_event(event, comp_x_func,
            comp_y_func, evtype);
    }

    send_new_sdfg_to_vscode() {
        vscode_write_graph(this.sdfg);
    }

}

function dom_setup(){
    $('#search-btn').click(() => {
        if (globals.daceRenderer)
            setTimeout(() => {
                find_in_graph(
                    globals.daceRenderer, globals.daceRenderer.graph,
                    $('#search').val(), $('#search-case')[0].checked
                );
            }, 1);
    });
    $('#search').on('keydown', (e) => {
        if (e.key === 'Enter' || e.which === 13) {
            if (globals.daceRenderer)
                setTimeout(() => {
                    find_in_graph(
                        globals.daceRenderer, globals.daceRenderer.graph,
                        $('#search').val(), $('#search-case')[0].checked
                    );
                }, 1);
            e.preventDefault();
        }
    });
}
