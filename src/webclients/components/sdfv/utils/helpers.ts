// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { find_graph_element_by_uuid, SDFGElement } from '@spcl/sdfv/out';
import { VSCodeRenderer } from '../renderer/vscode_renderer';

/**
 * Perform an action for each element in an array given by their uuids.
 */
export function doForAllUUIDs(
    uuids: string[], action: CallableFunction
): void {
    uuids.forEach((uuid) => {
        const result = find_graph_element_by_uuid(
            VSCodeRenderer.getInstance()?.get_graph(), uuid
        );

        let element = undefined;
        if (result !== undefined)
            element = result.element;

        if (element !== undefined) {
            action(element);
            const parent = element.parent;
            if (element.type().endsWith('Entry') && parent !== undefined) {
                const state = element.sdfg.nodes[element.parent_id];
                if (state.scope_dict[element.id] !== undefined) {
                    for (const nId of state.scope_dict[element.id])
                        action(parent.node(nId));
                }
            }
        }
    });
}

/**
 * Focus the view on a set of elements given by their uuids.
 */
export function zoomToUUIDs(uuids: string[]): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer) {
        const elementsToDisplay: SDFGElement[] = [];
        doForAllUUIDs(
            uuids, (element: SDFGElement) => elementsToDisplay.push(element)
        );
        renderer.zoom_to_view(elementsToDisplay);
    }
}

/**
 * Shade all elements in an array of element uuids with a light highlight color.
 * 
 * @param {*} uuids     Elements to shade.
 * @param {*} color     Color with which to highlight (defaults to wheat).
 */
export function highlightUUIDs(
    uuids: string[], pColor?: string
): void {
    const renderer = VSCodeRenderer.getInstance();
    const context = renderer?.get_context();
    if (renderer && context) {
        // Make sure no previously shaded elements remain shaded by drawing
        // synchronously.
        renderer.draw(null);

        let color = 'wheat';
        if (pColor !== undefined)
            color = pColor;

        if (!uuids.length) {
            renderer.get_graph()?.nodes().forEach((stateId: string) => {
                renderer.get_graph()?.node(stateId).shade(
                    renderer,
                    context,
                    color
                );
            });
        } else {
            doForAllUUIDs(uuids, (element: SDFGElement) => {
                element.shade(renderer, context, color);
            });
        }
    }
}
