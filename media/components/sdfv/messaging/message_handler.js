class MessageHandler {

    constructor() {}

    handle_message(message) {
        let el = undefined;
        switch (message.type) {
            case 'symbol_value_changed':
                if (message.symbol !== undefined && renderer)
                    renderer.overlay_manager.symbol_value_changed(
                        message.symbol,
                        message.value
                    );
                break;
            case 'update_badness_scale_method':
                if (message.method !== undefined && renderer)
                    renderer.overlay_manager.update_badness_scale_method(
                        message.method
                    );
                break;
            case 'refresh_symbol_list':
                analysis_pane_refresh_symbols();
                break;
            case 'refresh_outline':
                if (renderer)
                    outline(renderer, renderer.graph);
                break;
            case 'refresh_transformation_list':
                refresh_transformation_list();
                break;
            case 'get_applicable_transformations':
                get_applicable_transformations();
                break;
            case 'get_applicable_transformations_callback':
                if (message.transformations !== undefined)
                    transformations = [[], [], [], message.transformations];
                else
                    transformations = [[], [], [], []];
                sort_transformations(refresh_transformation_list);
                break;
            case 'flopsCallback':
                if (renderer && renderer.overlay_manager &&
                    renderer.overlay_manager.static_flops_overlay_active) {
                    const overlay = renderer.overlay_manager.get_overlay(
                        GenericSdfgOverlay.OVERLAY_TYPE.STATIC_FLOPS
                    );
                    if (overlay !== undefined && message.map !== undefined)
                        overlay.update_flops_map(message.map);
                }
                break;
            case 'update':
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
                break;
            case 'exit_preview':
                resetRendererContent();
                el = document.getElementById('exit-preview-button');
                if (el)
                    el.className = 'button hidden';
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
                if (message.transformation !== undefined)
                    show_transformation_details(message.transformation);
                break;
        }
    }

}