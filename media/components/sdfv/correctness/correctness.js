// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

function getTempColor(val) {
    if (val < 0)
        val = 0;
    if (val > 1)
        val = 1;
    const hue = ((1 - val) * 120).toString(10);
    return 'hsl(' + hue + ',100%,50%)';
}

daceGenericSDFGOverlay.OVERLAY_TYPE.CORRECTNESS = 'OVERLAY_TYPE_CORRECTNESS';

class CorrectnessOverlay extends daceGenericSDFGOverlay {

    breakpoints;
    daceRenderer;
    reports;

    constructor(daceRenderer, reports) {
        super(
            daceRenderer.overlay_manager, daceRenderer,
            daceGenericSDFGOverlay.OVERLAY_TYPE.CORRECTNESS
        );
        this.daceRenderer = daceRenderer;
        this.new_reports(reports);
        this.refresh();
    }

    get_sdfg_element(element, as_string = false) {
        let undefined_val = -1;
        let sdfg_id = undefined_val;
        let state_id = undefined_val;
        let node_id = undefined_val;

        if (element instanceof NestedSDFG) {
            sdfg_id = element.data.node.attributes.sdfg.sdfg_list_id;
        } else if (element instanceof State) {
            sdfg_id = element.sdfg.sdfg_list_id;
            state_id = element.id;
        } else if (element instanceof SDFGNode) {
            sdfg_id = element.sdfg.sdfg_list_id;
            state_id = element.parent_id;
            node_id = element.id;
        }

        if (!as_string)
            return {
                sdfg_id: sdfg_id,
                state_id: state_id,
                node_id: node_id,
            };
        else
            return (
                sdfg_id + '/' +
                state_id + '/' +
                node_id
            );
    }

    new_reports(arrays) {
        this.reports = new Map();
        arrays.forEach(array => {
            const identifer = `${array.sdfg_id}/${array.state_id}/-1`;
            let state_arrays = this.reports.get(identifer);
            if (state_arrays === undefined || state_arrays === null)
                state_arrays = [];
            state_arrays.push(array);
            this.reports.set(identifer, state_arrays);
        });
    }

    check_correctness(state, ctx) {
        const identifier = this.get_sdfg_element(state, true);
        const arrays = this.reports.get(identifier);
        console.log(arrays);
        if (arrays === null || arrays === undefined) return;
        let err_fraction = 1.;
        let err_msgs = '';
        for (const arr of arrays) {
            if (!arr['correct']) {
                err_fraction /= 2.;
                err_msgs += `${arr['array_name']}: ${arr['error_msg']}\n`;
            }
        }
        this.draw_tooltip(state, err_msgs);
        state.shade(this.daceRenderer, ctx, getTempColor(1 - err_fraction));
    }

    draw() {
        this.recursively_shade_sdfg(
            this.daceRenderer.graph,
            this.daceRenderer.ctx,
            this.daceRenderer.canvas_manager.points_per_pixel(),
            this.daceRenderer.visible_rect
        );
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) { }

    draw_tooltip(node, msg) {
        if (this.daceRenderer.mousepos &&
            node.intersect(this.daceRenderer.mousepos.x,
                this.daceRenderer.mousepos.y) && msg !== '') {
            this.daceRenderer.tooltip = () => {
                this.daceRenderer.tooltip_container.innerText = (msg);
                this.daceRenderer.tooltip_container.className = 'sdfvtooltip';
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
                this.check_correctness(state, ctx);
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
                    });
                }
            }
        });
    }

    refresh() {
        this.draw();
        this.daceRenderer.draw_async();
    }
}
