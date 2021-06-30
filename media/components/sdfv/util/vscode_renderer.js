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
                document.getElementById('elem_libnode'),
                document.getElementById('elem_access_node'),
                document.getElementById('elem_stream'),
                document.getElementById('elem_state'),
                document.getElementById('elem_connector'),
                document.getElementById('elem_edge'),
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

    add_node_to_graph(
        add_type, parent, edge_a = undefined
    ) {
        let g = this.sdfg;
        un_graphiphy_sdfg(g);
        vscode.postMessage({
            type: 'dace.insert_node',
            sdfg: JSON.stringify(g),
            add_type: add_type,
            parent: parent,
            edge_a: edge_a,
        });
    }

    remove_graph_nodes(nodes) {
        let g = this.sdfg;
        un_graphiphy_sdfg(g);

        const uuids = [];
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const uuid = daceGetUUIDGraphElement(node);
            uuids.push(uuid);
        }

        vscode.postMessage({
            type: 'dace.remove_nodes',
            sdfg: JSON.stringify(g),
            uuids: uuids,
        });
    }

    /**
     * Set the correct poisiton for newly added graph elements.
     * This is called as a callback after a new element has been added to the
     * graph and uses a previously stored adding poistion to correctly
     * position the newly added element.
     */
    update_new_element(uuids) {
        if (!this.add_position)
            return;

        let first = uuids[0];

        if (first === 'NONE')
            return;

        let el = daceFindGraphElementByUUID(this.graph, first).element;
        // TODO: set in construction attribute
        this.canvas_manager.translate_element(
            el, { x: el.x, y: el.y }, this.add_position, this.sdfg,
            this.sdfg_list, this.state_parent_list, null, true
        );

        this.add_position = null;

        this.send_new_sdfg_to_vscode();
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
