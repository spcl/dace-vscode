// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    OperationalIntensityOverlay,
    StaticFlopsOverlay,
} from '@spcl/sdfv/out';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';

declare const vscode: any;

/**
 * Register all current SDFG's symbols in the analysis pane.
 */
export async function analysisPaneRegisterSymbols(): Promise<void> {
    const symbols = VSCodeRenderer.getInstance()?.get_sdfg().attributes.symbols;
    if (symbols)
        return SDFVComponent.getInstance().invoke(
            'analysisAddSymbols', [symbols]
        );
}

/**
 * Refresh the symbols and their values in the analysis pane.
 */
export async function analysisPaneRefreshSymbols(): Promise<void> {
    const renderer = VSCodeRenderer.getInstance();
    if (renderer !== null && vscode !== undefined) {
        const symbolResolver =
            renderer.get_overlay_manager()?.get_symbol_resolver();
        const map = symbolResolver?.get_symbol_value_map();
        Object.keys(map).forEach((symbol) => {
            if (map[symbol] === undefined)
                map[symbol] = '';
        });
        return SDFVComponent.getInstance().invoke(
            'analysisSetSymbols', [map]
        );
    }
}

export async function refreshAnalysisPane(): Promise<void> {
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

        const symbols = map;
        const availableOverlays = [
            {
                class: 'MemoryVolumeOverlay',
                label: 'Logical Memory Volume',
                type: MemoryVolumeOverlay.type,
            },
            {
                class: 'StaticFlopsOverlay',
                label: 'Arithmetic Operations',
                type: StaticFlopsOverlay.type,
            },
            {
                class: 'MemoryLocationOverlay',
                label: 'Memory Location',
                type: MemoryLocationOverlay.type,
            },
            {
                class: 'OperationalIntensityOverlay',
                label: 'Operational Intensity',
                type: OperationalIntensityOverlay.type,
            },
        ];
        return SDFVComponent.getInstance().invoke(
            'updateAnalysisPanel', [
                activeOverlays,
                symbols,
                overlayManager.get_heatmap_scaling_method(),
                additionalMethodVal,
                availableOverlays
            ]
        );
    }
}
