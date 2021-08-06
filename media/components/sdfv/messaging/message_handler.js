// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class MessageHandler {

    constructor() { }

    handle_message(message) {
        let el = undefined;
        switch (message.type) {
            case 'load_instrumentation_report':
                daceRenderer.overlay_manager.deregister_overlay(
                    daceStaticFlopsOverlay
                );
                instrumentation_report_read_complete(message.result);
            // Fall through to set the criterium.
            case 'instrumentation_report_change_criterium':
                if (message.criterium) {
                    const ol = daceRenderer.overlay_manager.get_overlay(
                        daceStaticFlopsOverlay
                    );
                    if (ol) {
                        ol.criterium = message.criterium;
                        ol.refresh();
                    }
                }
                break;
            case 'clear_instrumentation_report':
                daceRenderer.overlay_manager.deregister_overlay(
                    daceRuntimeMicroSecondsOverlay
                );
                break;
            case 'symbol_value_changed':
                if (message.symbol !== undefined && daceRenderer)
                    daceRenderer.overlay_manager.symbol_value_changed(
                        message.symbol,
                        message.value
                    );
                break;
            case 'update_badness_scale_method':
                if (message.method !== undefined && daceRenderer)
                    daceRenderer.overlay_manager.update_badness_scale_method(
                        message.method
                    );
                break;
            case 'register_overlay':
                if (message.overlay !== undefined && daceRenderer)
                    daceRenderer.overlay_manager.register_overlay(
                        window[message.overlay]
                    );
                break;
            case 'deregister_overlay':
                if (message.overlay !== undefined && daceRenderer)
                    daceRenderer.overlay_manager.deregister_overlay(
                        window[message.overlay]
                    );
                break;
            case 'register_breakpointindicator':
                if (daceRenderer)
                    daceRenderer.overlay_manager.register_overlay(
                        new BreakpointIndicator(daceRenderer)
                    );
                break;
            case 'deregister_breakpointindicator':
                if (daceRenderer)
                    daceRenderer.overlay_manager.deregister_overlay(
                        BreakpointIndicator
                    );
                break;
            case 'refresh_symbol_list':
                analysis_pane_refresh_symbols();
                break;
            case 'refresh_analysis_pane':
                refresh_analysis_pane();
                break;
            case 'refresh_breakpoints':
                refresh_breakpoints();
                break;
            case 'refresh_sdfg_breakpoints':
                refresh_sdfg_breakpoints();
                break;
            case 'refresh_outline':
                if (daceRenderer)
                    embedded_outline(daceRenderer, daceRenderer.graph);
                break;
            case 'refresh_transformation_list':
                refresh_transformation_list();
                break;
            case 'resync_transformation_list':
                clear_selected_transformation();
                if (transformations !== undefined &&
                    transformations !== [[], [], [], []])
                    refresh_transformation_list();
                else
                    get_applicable_transformations();
                break;
            case 'refresh_sdfg':
                refreshSdfg();
                break;
            case 'get_applicable_transformations':
                clear_selected_transformation();
                get_applicable_transformations();
                break;
            case 'get_applicable_transformations_callback':
                daemon_connected = true;
                if (message.transformations !== undefined)
                    transformations = [[], [], [], message.transformations];
                else
                    transformations = [[], [], [], []];
                const hide_loading = true;
                sort_transformations(refresh_transformation_list, hide_loading);
                break;
            case 'flopsCallback':
                if (daceRenderer && daceRenderer.overlay_manager &&
                    daceRenderer.overlay_manager.is_overlay_active(
                        daceStaticFlopsOverlay
                    )
                ) {
                    const overlay = daceRenderer.overlay_manager.get_overlay(
                        daceStaticFlopsOverlay
                    );
                    if (overlay !== undefined && message.map !== undefined)
                        overlay.update_flops_map(message.map);
                }
                break;
            case 'update':
                window.viewing_history_state = false;
                el = document.getElementById('exit-preview-button');
                if (el)
                    el.className = 'button hidden';
                if (message.prevent_refreshes)
                    setRendererContent(message.text, false, true);
                else
                    setRendererContent(message.text);
                break;
            case 'processing':
                if (message.show && message.show === true) {
                    $('#processing-overlay').show();
                    $('#processing-overlay-msg').text(message.text);
                } else {
                    $('#processing-overlay').hide();
                    $('#processing-overlay-msg').text();
                }
                break;
            case 'preview_sdfg':
                setRendererContent(message.text, true);
                el = document.getElementById('exit-preview-button');
                if (el)
                    el.className = 'button';

                if (message.hist_state !== undefined && message.hist_state) {
                    clear_info_box();
                    window.viewing_history_state = true;
                    refresh_transformation_list();
                }
                break;
            case 'exit_preview':
                resetRendererContent();
                window.viewing_history_state = false;
                el = document.getElementById('exit-preview-button');
                if (el)
                    el.className = 'button hidden';
                if (message.refresh_transformations)
                    refresh_transformation_list();
                break;
            case 'highlight_elements':
                if (message.elements)
                    highlight_uuids(Object.values(message.elements));
                break;
            case 'zoom_to_node':
                if (message.uuid !== undefined)
                    zoom_to_uuids([message.uuid]);
                break;
            case 'select_transformation':
                if (message.transformation !== undefined) {
                    show_transformation_details(message.transformation);
                    window.selected_transformation = message.transformation;
                }
                break;
            case 'clear_selected_transformation':
                clear_selected_transformation();
                break;
            case 'added_node':
                if (message.uuid !== 'error') {
                    daceRenderer.set_sdfg(message.sdfg);
                    daceRenderer.update_new_element(message.uuid);
                }
                break;
            case 'set_sdfg_metadata':
                if (message.meta_dict)
                    window.sdfg_meta_dict = message.meta_dict;
                break;
            case 'unbound_breakpoint':
                daceRenderer.overlay_manager.get_overlay(
                    BreakpointIndicator
                ).unbound_breakpoint(message.node);
                break;
            case 'remove_breakpoint':
                if (daceRenderer.sdfg.attributes.name === message.node.sdfg_name) {
                    const ol = daceRenderer.overlay_manager.get_overlay(
                        BreakpointIndicator
                    );
                    // This can can be called while the SDFG isn't displayed
                    if (ol !== undefined && ol !== null)
                        ol.remove_breakpoint(message.node);
                }
                break;
            case 'saved_nodes':
                daceRenderer.overlay_manager.get_overlay(
                    BreakpointIndicator
                ).set_saved_nodes(message.nodes);
                break;
            case 'display_breakpoints':
                displayBreakpoints(message.display);
                break;
            case 'daemon_connected':
                daemon_connected = true;
                break;
        }
    }

}