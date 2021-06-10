// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

function refresh_breakpoints() {
    if (renderer !== undefined && renderer !== null && vscode !== undefined) {
        vscode.postMessage({
            type: 'breakpoints.refresh_breakpoints',
            show_breakpoints: renderer.bpIndicator.show_breakpoints
        });
    }
}

const BreakpointEnum = Object.freeze({ "UNBOUND": 0, "BOUND": 1 });

class BreakpointIndicator {

    breakpoints;
    renderer;
    show_breakpoints;

    constructor(renderer) {
        this.renderer = renderer;
        this.breakpoints = new Map()
        this.show_breakpoints = false;
    }

    get_sdfg_element(element, as_string = false) {
        let undefined_val = -1;
        let sdfg_id = undefined_val;
        let state_id = undefined_val;
        let node_id = undefined_val;

        if (element instanceof NestedSDFG) {
            sdfg_id = element.data.node.attributes.sdfg.sdfg_list_id;
        }
        else if (element instanceof State) {
            sdfg_id = element.sdfg.sdfg_list_id;
            state_id = element.id;
        }
        else if (element instanceof Node) {
            sdfg_id = element.sdfg.sdfg_list_id;
            state_id = element.parent_id;
            node_id = element.id;
        }

        if (!as_string)
            return {
                sdfg_id: sdfg_id,
                state_id: state_id,
                node_id: node_id
            };
        else
            return (
                sdfg_id + '/' +
                state_id + '/' +
                node_id
            );
    }

    draw() {
        if (this.show_breakpoints)
            this.recursively_shade_sdfg(
                this.renderer.graph,
                this.renderer.ctx,
                this.renderer.canvas_manager.points_per_pixel(),
                this.renderer.visible_rect
            );
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        if (type === 'contextmenu') {
            if (
                foreground_elem !== undefined &&
                foreground_elem !== null &&
                !(foreground_elem instanceof Edge)
            ) {
                let sdfg_elem = this.get_sdfg_element(foreground_elem);

                let elem_uuid = (
                    sdfg_elem.sdfg_id + '/' +
                    sdfg_elem.state_id + '/' +
                    sdfg_elem.node_id
                );

                if (this.breakpoints.has(elem_uuid)) {
                    this.breakpoints.delete(elem_uuid);
                    this.erase_breakpoint(foreground_elem, this.renderer.ctx);
                    vscode.postMessage({
                        type: 'breakpoints.remove_breakpoint',
                        node: sdfg_elem
                    });
                }
                else {
                    this.breakpoints.set(elem_uuid, BreakpointEnum.BOUND);
                    this.draw_breakpoint(foreground_elem, this.renderer.ctx);
                    vscode.postMessage({
                        type: 'breakpoints.add_breakpoint',
                        node: sdfg_elem
                    });
                }
            }
        }
    }

    check_breakpoint(node, ctx) {
        let elem_uuid = this.get_sdfg_element(node, true);

        if (this.breakpoints.has(elem_uuid)) {
            const breakpoint_type = this.breakpoints.get(elem_uuid);
            let msg = (breakpoint_type === BreakpointEnum.UNBOUND) ?
                'Right click to remove the Breakpoint' :
                'The Breakpoint set on this node is unbounded';
            this.draw_tooltip(node, msg);
            this.draw_breakpoint(node, ctx, breakpoint_type);
        }
        else {
            this.draw_tooltip(node, 'Right click to set a Breakpoint');
        }
    }

    draw_breakpoint(node, ctx, bp_enum) {
        // Draw a red circle to indicate that a breakpoint is set
        let color = (bp_enum === BreakpointEnum.BOUND) ? 'red': '#D3D3D3';
        this.draw_breakpoint_circle(node, ctx, 'black', color);
    }

    erase_breakpoint(node, ctx) {
        // Draw on top of the Breakpoint
        let background = node.getCssProperty(renderer, '--state-background-color');
        this.draw_breakpoint_circle(node, ctx, background, background);
    }

    draw_breakpoint_circle(node, ctx, stroke_color, fill_color) {
        // Draw the circle, if the node is a STATE, draw the BP at
        // the top left, otherwise draw the BP at the middle left
        let topleft = node.topleft();
        ctx.strokeStyle = stroke_color;
        ctx.fillStyle = fill_color;
        ctx.beginPath();
        (node instanceof State) ?
            ctx.arc(topleft.x + 10, topleft.y + 20, 4, 0, 2 * Math.PI) :
            ctx.arc(topleft.x - 10, topleft.y + node.height / 2.0, 4, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fill();
    }

    draw_tooltip(node, msg) {
        if (this.renderer.mousepos &&
            node.intersect(this.renderer.mousepos.x, this.renderer.mousepos.y)) {
            this.renderer.tooltip = () => {
                this.renderer.tooltip_container.innerText = (msg);
                this.renderer.tooltip_container.className = 'sdfvtooltip';
            };
        }
    }

    recursively_shade_sdfg(graph, ctx, ppp, visible_rect) {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // If it's expanded or zoomed in close enough, we traverse inside.
        graph.nodes().forEach(v => {
            let state = graph.node(v);
            // If the node's invisible, we skip it.
            if (ctx.lod && !state.intersect(visible_rect.x, visible_rect.y,
                visible_rect.w, visible_rect.h))
                return;

            if ((ctx.lod && (ppp >= STATE_LOD ||
                state.width / ppp <= STATE_LOD)) ||
                state.data.state.attributes.is_collapsed) {
                // Currently we don't do anything
            } else {
                this.check_breakpoint(state, ctx);
                let state_graph = state.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach(v => {
                        let node = state_graph.node(v);

                        // Skip the node if it's not visible.
                        if (ctx.lod && !node.intersect(visible_rect.x,
                            visible_rect.y, visible_rect.w, visible_rect.h))
                            return;

                        // Check if the node is a NestedSDFG and if
                        // it should be visited
                        if (
                            !(node.data.node.attributes.is_collapsed ||
                                (ctx.lod && ppp >= NODE_LOD)) &&
                            node instanceof NestedSDFG
                        ) {
                            this.recursively_shade_sdfg(
                                node.data.graph, ctx, ppp, visible_rect
                            );
                        }

                        this.check_breakpoint(node, ctx);
                    });
                }
            }
        });
    }

    refresh() {
        this.renderer.draw_async();
    }

    display_breakpoints() {
        this.show_breakpoints = true;
        this.draw();
        this.renderer.draw_async()
    }

    hide_breakpoints() {
        this.show_breakpoints = false;
        this.draw();
        this.renderer.draw_async()
    }

    handle_mouse_event(event, comp_x_func, comp_y_func, evtype) {
        // Don't consider mouse events if we don't display the bp's
        if (!this.show_breakpoints)
            return;

        let mousepos = { x: comp_x_func(event), y: comp_y_func(event) };

        // Find elements under cursor
        const elements_under_cursor = this.renderer.find_elements_under_cursor(
            mousepos.x, mousepos.y
        );
        let elements = elements_under_cursor.elements;
        let foreground_elem = elements_under_cursor.foreground_elem;

        let ends_drag = false;
        let mouse_x = comp_x_func(event);
        let mouse_y = comp_y_func(event);

        this.on_mouse_event(
            evtype,
            event,
            { x: mouse_x, y: mouse_y },
            elements,
            foreground_elem,
            ends_drag
        );

        this.renderer.draw_async();
    }

    unbound_breakpoint(node) {
        console.log('unbounding');
        let elem_uuid = (
            node.sdfg_id + '/' +
            node.state_id + '/' +
            node.node_id
        );
        if (this.breakpoints.has(elem_uuid)){
            this.breakpoints.set(elem_uuid, BreakpointEnum.UNBOUND);
        }
        this.draw();
        this.renderer.draw_async();
    }

}
