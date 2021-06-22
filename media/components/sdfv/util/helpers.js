// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

/**
 * Perform an action for each element in an array given by their uuids.
 * 
 * @param {*} uuids     Elements for which to perform the action.
 * @param {*} action    Action to perform.
 */
function do_for_all_uuids(uuids, action) {
    uuids.forEach((uuid) => {
        const result = daceFindGraphElementByUUID(daceRenderer.graph, uuid);

        let element = undefined;
        if (result !== undefined)
            element = result.element;

        if (element !== undefined) {
            action(element);
            const parent = element.parent;
            if (element.type().endsWith('Entry') && parent !== undefined) {
                const state = element.sdfg.nodes[element.parent_id];
                if (state.scope_dict[element.id] !== undefined) {
                    for (const n_id of state.scope_dict[element.id])
                        action(parent.node(n_id));
                }
            }
        }
    });
}

/**
 * Focus the view on a set of elements given by their uuids.
 * 
 * @param {*} uuids     Elements to zoom to.
 */
function zoom_to_uuids(uuids) {
    if (daceRenderer) {
        const elements_to_display = [];
        do_for_all_uuids(uuids, (element) => elements_to_display.push(element));
        daceRenderer.zoom_to_view(elements_to_display);
    }
}

/**
 * Shade all elements in an array of element uuids with a light highlight color.
 * 
 * @param {*} uuids     Elements to shade.
 * @param {*} color     Color with which to highlight (defaults to wheat).
 */
function highlight_uuids(uuids, color) {
    if (daceRenderer) {
        // Make sure no previously shaded elements remain shaded by drawing
        // synchronously.
        daceRenderer.draw();

        if (color === undefined)
            color = 'wheat';

        if (!uuids.length) {
            daceRenderer.graph.nodes().forEach((state_id) => {
                daceRenderer.graph.node(state_id).shade(
                    daceRenderer,
                    daceRenderer.ctx,
                    color
                );
            });
        } else {
            do_for_all_uuids(uuids, (element) => {
                element.shade(daceRenderer, daceRenderer.ctx, color);
            });
        }
    }
}