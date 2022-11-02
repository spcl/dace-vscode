// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    instrumentation_report_read_complete,
    LogicalGroupOverlay, RuntimeMicroSecondsOverlay,
    StaticFlopsOverlay
} from '@spcl/sdfv/out';
import {
    analysisPaneRegisterSymbols
} from '../analysis/analysis';
import {
    BreakpointIndicator,
    refreshBreakpoints
} from '../breakpoints/breakpoints';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import {
    applyTransformations,
    clearSelectedTransformation,
    getApplicableTransformations,
    refreshTransformationList,
    showTransformationDetails,
    sortTransformations
} from '../transformation/transformation';
import { VSCodeSDFV } from '../vscode_sdfv';

export class MessageHandler {

    private static readonly INSTANCE = new MessageHandler();

    private constructor() {}

    public static getInstance(): MessageHandler {
        return this.INSTANCE;
    }

    public handleMessage(message: any): void {
        const renderer = VSCodeRenderer.getInstance();
        const sdfv = VSCodeSDFV.getInstance();
        switch (message.type) {
            case 'apply_transformations':
                if (message.transformations)
                    applyTransformations(...message.transformations);
                break;
            case 'load_instrumentation_report':
                renderer?.get_overlay_manager().deregister_overlay(
                    StaticFlopsOverlay
                );
                if (message.result)
                    instrumentation_report_read_complete(
                        sdfv, message.result, renderer
                    );
            // Fall through to set the criterium.
            case 'instrumentation_report_change_criterium':
                if (message.criterium) {
                    const ol = renderer?.get_overlay_manager().get_overlay(
                        RuntimeMicroSecondsOverlay
                    );
                    if (ol && ol instanceof RuntimeMicroSecondsOverlay) {
                        ol.set_criterium(message.criterium);
                        ol.refresh();
                    }
                }
                break;
            case 'clear_instrumentation_report':
                renderer?.get_overlay_manager().deregister_overlay(
                    RuntimeMicroSecondsOverlay
                );
                break;
            case 'symbol_value_changed':
                renderer?.get_overlay_manager().on_symbol_value_changed(
                    message.symbol,
                    message.value
                );
                break;
            case 'update_heatmap_scaling_method':
                renderer?.get_overlay_manager().update_heatmap_scaling_method(
                    message.method
                );

                if (message.additionalVal !== undefined) {
                    switch (message.method) {
                        case 'hist':
                            renderer?.get_overlay_manager()
                                .update_heatmap_scaling_hist_n_buckets(
                                    message.additionalVal
                                );
                            break;
                        case 'exponential_interpolation':
                            renderer?.get_overlay_manager()
                                .update_heatmap_scaling_exp_base(
                                    message.additionalVal
                                );
                            break;
                    }
                }
                break;
            case 'register_overlay':
                {
                    const ol = message.overlay;
                    if (typeof ol === 'string' && ol &&
                        !renderer?.get_overlay_manager().is_overlay_active(
                            VSCodeSDFV.OVERLAYS[ol]
                        )
                    ) {
                        renderer?.get_overlay_manager().register_overlay(
                            VSCodeSDFV.OVERLAYS[ol]
                        );
                    }
                }
                break;
            case 'deregister_overlay':
                {
                    const ol = message.overlay;
                    if (typeof ol === 'string' && ol) {
                        renderer?.get_overlay_manager().deregister_overlay(
                            VSCodeSDFV.OVERLAYS[ol]
                        );
                    }
                }
                break;
            case 'set_overlays':
                {
                    // Query all active overlays
                    const olm = renderer?.get_overlay_manager();
                    const activeOverlays = olm?.get_overlays();

                    // Deregister any previously active overlays.
                    if (activeOverlays) {
                        for (const ol of activeOverlays) {
                            // Never deregister the logical group overlay.
                            if (ol instanceof LogicalGroupOverlay)
                                continue;

                            // Find the correct type for the registered overlay.
                            let type = undefined;
                            for (const overlayType of
                                Object.values(VSCodeSDFV.OVERLAYS)) {
                                if (ol instanceof overlayType) {
                                    type = overlayType;
                                    break;
                                }
                            }

                            // Don't deregister overlays that should be
                            // registered.
                            let included = false;
                            for (const requestedOverlay of message.overlays) {
                                const requestedOverlayType =
                                    VSCodeSDFV.OVERLAYS[requestedOverlay];
                                if (ol instanceof requestedOverlayType) {
                                    included = true;
                                    break;
                                }
                            }

                            if (!included && type)
                                olm?.deregister_overlay(type);
                        }
                    }

                    // Register all the selected overlays.
                    for (const ol of message.overlays) {
                        if (!olm?.is_overlay_active(VSCodeSDFV.OVERLAYS[ol]))
                            olm?.register_overlay(VSCodeSDFV.OVERLAYS[ol]);
                    }
                }
                break;
            case 'register_breakpointindicator':
                renderer?.get_overlay_manager().register_overlay(
                    BreakpointIndicator
                );
                break;
            case 'deregister_breakpointindicator':
                renderer?.get_overlay_manager().deregister_overlay(
                    BreakpointIndicator
                );
                break;
            case 'refresh_symbol_list':
                analysisPaneRegisterSymbols();
                break;
            case 'refresh_sdfg_breakpoints':
                refreshBreakpoints();
                break;
            case 'refresh_outline':
                {
                    const graph = renderer?.get_graph();
                    if (renderer && graph)
                        sdfv.outline(renderer, graph);
                }
                break;
            case 'refresh_transformation_list':
                refreshTransformationList();
                break;
            case 'get_applicable_transformations':
                clearSelectedTransformation();
                getApplicableTransformations();
                break;
            case 'get_applicable_transformations_callback':
                sdfv.setDaemonConnected(true);
                if (message.transformations !== undefined)
                    sdfv.setTransformations({
                        selection: [],
                        viewport: [],
                        passes: [],
                        uncategorized: [{
                            title: 'Uncategorized',
                            ordering: 0,
                            xforms: message.transformations,
                        }],
                    });
                else
                    sdfv.setTransformations({
                        selection: [],
                        viewport: [],
                        passes: [],
                        uncategorized: [],
                    });
                const hideLoading = true;
                sortTransformations(
                    true, refreshTransformationList, hideLoading
                );
                break;
            case 'select_transformation':
                if (message.transformation !== undefined) {
                    showTransformationDetails(message.transformation);
                    sdfv.setSelectedTransformation(message.transformation);
                }
                break;
            case 'clear_selected_transformation':
                clearSelectedTransformation();
                break;
            case 'added_node':
                if (message.uuid !== 'error') {
                    renderer?.set_sdfg(message.sdfg);
                    renderer?.updateNewElement(message.uuid);
                }
                break;
            case 'unbound_breakpoint':
                {
                    const overlay = renderer?.get_overlay_manager().get_overlay(
                        BreakpointIndicator
                    );
                    if (overlay && overlay instanceof BreakpointIndicator)
                        overlay.unboundBreakpoint(message.node);
                }
                break;
            case 'remove_breakpoint':
                if (renderer?.get_sdfg().attributes.name ===
                    message.node.sdfg_name) {
                    const ol = renderer?.get_overlay_manager().get_overlay(
                        BreakpointIndicator
                    );
                    // This can can be called while the SDFG isn't displayed
                    if (ol !== undefined && ol !== null &&
                        ol instanceof BreakpointIndicator)
                        ol.removeBreakpoint(message.node);
                }
                break;
            case 'saved_nodes':
                {
                    const overlay = renderer?.get_overlay_manager().get_overlay(
                        BreakpointIndicator
                    );
                    if (overlay && overlay instanceof BreakpointIndicator)
                        overlay.setSavedNodes(message.nodes);
                }
                break;
            case 'display_breakpoints':
                sdfv.setShowingBreakpoints(message.display);
                break;
        }
    }

}
