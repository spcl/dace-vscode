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