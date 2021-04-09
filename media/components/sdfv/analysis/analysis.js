// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

/**
 * Register all current SDFG's symbols in the analysis pane.
 */
function analysis_pane_register_symbols() {
    if (renderer !== undefined && vscode !== undefined)
        vscode.postMessage({
            type: 'analysis.add_symbols',
            symbols: renderer.sdfg.attributes.symbols,
        });
}

/**
 * Refresh the symbols and their values in the analysis pane.
 */
function analysis_pane_refresh_symbols() {
    if (renderer !== undefined && vscode !== undefined) {
        const map = renderer.overlay_manager.symbol_resolver.symbol_value_map;
        Object.keys(map).forEach((symbol) => {
            if (map[symbol] === undefined)
                map[symbol] = '';
        });
        vscode.postMessage({
            type: 'analysis.set_symbols',
            symbols: map,
        });
    }
}

function refresh_analysis_pane() {
    if (renderer !== undefined && renderer !== null && vscode !== undefined) {
        const map = renderer.overlay_manager.symbol_resolver.symbol_value_map;
        Object.keys(map).forEach((symbol) => {
            if (map[symbol] === undefined)
                map[symbol] = '';
        });

        const active_overlays = [];
        for (const active_overlay of renderer.overlay_manager.overlays)
            active_overlays.push(active_overlay.type);

        vscode.postMessage({
            type: 'analysis.refresh_analysis_pane',
            symbols: map,
            badness_scale_method: renderer.overlay_manager.badness_scale_method,
            available_overlays: {
                'Memory Volume': GenericSdfgOverlay.OVERLAY_TYPE.MEMORY_VOLUME,
                'Static FLOP': GenericSdfgOverlay.OVERLAY_TYPE.STATIC_FLOPS,
            },
            active_overlays: active_overlays,
        });
    }
}