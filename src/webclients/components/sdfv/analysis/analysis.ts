// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { MemoryLocationOverlay, MemoryVolumeOverlay, OperationalIntensityOverlay, StaticFlopsOverlay } from '@spcl/sdfv/out';
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

        let additionalMethodVal = undefined;
        switch (overlayManager.get_heatmap_scaling_method()) {
            case 'hist':
                additionalMethodVal =
                    overlayManager.get_heatmap_scaling_hist_n_buckets();
                break;
            case 'exponential_interpolation':
                additionalMethodVal =
                    overlayManager.get_heatmap_scaling_exp_base();
                break;
        }

        vscode.postMessage({
            type: 'analysis.refresh_analysis_pane',
            symbols: map,
            heatmapScalingMethod: overlayManager.get_heatmap_scaling_method(),
            heatmapScalingAdditionalVal: additionalMethodVal,
            availableOverlays: [
                {
                    class: MemoryVolumeOverlay.name,
                    label: 'Logical Memory Volume',
                    type: MemoryVolumeOverlay.type,
                },
                {
                    class: StaticFlopsOverlay.name,
                    label: 'Arithmetic Operations',
                    type: StaticFlopsOverlay.type,
                },
                {
                    class: MemoryLocationOverlay.name,
                    label: 'Memory Location',
                    type: MemoryLocationOverlay.type,
                },
                {
                    class: OperationalIntensityOverlay.name,
                    label: 'Operational Intensity',
                    type: OperationalIntensityOverlay.type,
                },
            ],
            activeOverlays: activeOverlays,
        });
    }
}
