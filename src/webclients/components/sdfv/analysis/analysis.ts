// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { VSCodeRenderer } from '../renderer/vscode_renderer';

declare const vscode: any;

/**
 * Register all current SDFG's symbols in the analysis pane.
 */
export function analysisPaneRegisterSymbols(): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer !== null && vscode !== undefined)
        vscode.postMessage({
            type: 'analysis.add_symbols',
            symbols: renderer.get_sdfg().attributes.symbols,
        });
}

/**
 * Refresh the symbols and their values in the analysis pane.
 */
export function analysisPaneRefreshSymbols(): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer !== null && vscode !== undefined) {
        const symbolResolver =
            renderer.get_overlay_manager()?.get_symbol_resolver();
        const map = symbolResolver?.get_symbol_value_map();
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

export function refreshAnalysisPane(): void {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer !== null && vscode !== undefined) {
        const overlayManager = renderer.get_overlay_manager();
        const symbolResolver = overlayManager?.get_symbol_resolver();
        const map = symbolResolver?.get_symbol_value_map();
        Object.keys(map).forEach((symbol) => {
            if (map[symbol] === undefined)
                map[symbol] = '';
        });

        const activeOverlays = [];
        for (const activeOverlay of overlayManager.get_overlays())
            activeOverlays.push(activeOverlay.constructor.name);

        vscode.postMessage({
            type: 'analysis.refresh_analysis_pane',
            symbols: map,
            badnessScaleMethod: overlayManager.get_badness_scale_method(),
            availableOverlays: {
                'Memory Volume': 'MemoryVolumeOverlay',
                'Static FLOP': 'StaticFlopsOverlay',
            },
            activeOverlays: activeOverlays,
        });
    }
}
