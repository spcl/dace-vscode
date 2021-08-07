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

function changeTextInput(val) {
    const diffInput = document.getElementById('diffInputText');
    if (diffInput !== null)
        diffInput.value = val !== '0' ? '1e-' + val : '1';
}

function changeDiff(diffRange, diffText) {
    if (diffRange === undefined || diffRange === null)
        diffRange = 5;
    if (diffText === undefined || diffText === null)
        diffText = '1e-5';

    const modal = create_single_use_modal(
        'Change correctness difference',
        true,
        ''
    );
    $('<input>', {
        type: 'range',
        id: 'diffInputRange',
        min: 0,
        max: 10,
        value: diffRange,
        onchange: "changeTextInput(this.value);",
    }).appendTo(modal.body);
    $('<input>', {
        type: 'text',
        id: 'diffInputText',
        value: diffText,
        style: 'margin-left:2rem;'
    }).appendTo(modal.body);
    modal.confirm_btn.on('click', () => {
        const valText = document.getElementById('diffInputText').value;
        const val = parseFloat(valText);
        const valRange = document.getElementById('diffInputRange').value;

        const ol = daceRenderer.overlay_manager.get_overlay(
            CorrectnessOverlay
        );
        ol.diff = val;
        ol.diffRange = valRange;
        ol.diffText = valText;
        ol.refresh();

        if (diffRange !== valRange || diffText !== valText)
            vscode.postMessage({
                type: 'bp_handler.changeDiffValue',
                diffRange: valRange,
                diffText: valText,
            });
        modal.modal.modal('hide');
    });
    modal.modal.modal('show');
}

class CorrectnessOverlay extends daceGenericSDFGOverlay {

    breakpoints;
    daceRenderer;
    reports_states;
    reports_nodes;
    arrays;
    diff;
    diffRange;
    diffText;

    constructor(daceRenderer, reports) {
        super(
            daceRenderer.overlay_manager, daceRenderer
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
        this.reports_states = new Map();
        this.reports_nodes = new Map();

        if (arrays === null || arrays === undefined) return;

        arrays.forEach(array => {
            const id_state = `${array.sdfg_id}/${array.state_id}/-1`;
            const id_node = `${array.sdfg_id}/${array.state_id}/${array.node_id}`;
            let state_arrays = this.reports_states.get(id_state);
            if (state_arrays === undefined || state_arrays === null)
                state_arrays = [];
            array.diff = parseFloat(array.diff);
            state_arrays.push(array);
            this.reports_states.set(id_state, state_arrays);
            this.reports_nodes.set(id_node, {
                msg: array.msg,
                diff: array.diff
            });
        });
    }

    check_correctness_state(state, ctx) {
        const identifier = this.get_sdfg_element(state, true);
        const arrays = this.reports_states.get(identifier);
        if (arrays === null || arrays === undefined) return;
        let err_fraction = 1.;
        for (const arr of arrays) {
            if (arr.diff > this.diff) {
                err_fraction /= 2.;
            }
        }
        if (err_fraction !== 1.)
            this.stateOutline(state, ctx, 'red');
    }

    check_correctness_node(node, ctx) {
        const identifier = this.get_sdfg_element(node, true);
        const node_report = this.reports_nodes.get(identifier);
        if (node_report === null || node_report === undefined) return;
        this.draw_tooltip(node, node_report.msg);
        node.shade(this.daceRenderer, ctx,
            node_report.diff <= this.diff ?
                'green' : 'red'
        );
    }

    stateOutline(state, ctx, color) {
        const topleft = state.topleft();
        const oldLineWidth = ctx.lineWidth;
        ctx.lineWidth = Math.floor(state.width / 50);
        ctx.strokeStyle = color;
        ctx.strokeRect(topleft.x, topleft.y, state.width, state.height);
        ctx.lineWidth = oldLineWidth;
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
                this.daceRenderer.mousepos.y)) {
            if (msg === '')
                this.daceRenderer.tooltip = () => {
                    this.daceRenderer.tooltip_container
                        .className = 'sdfvtooltip_hide';
                };
            else
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
                this.check_correctness_state(state, ctx) + '\n';
                let state_graph = state.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach(v => {
                        let node = state_graph.node(v);

                        // Skip the node if it's not visible.
                        if (ctx.lod && !node.intersect(visible_rect.x,
                            visible_rect.y, visible_rect.w, visible_rect.h))
                            return;

                        if (node instanceof AccessNode) {
                            this.check_correctness_node(node, ctx);
                        }

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
