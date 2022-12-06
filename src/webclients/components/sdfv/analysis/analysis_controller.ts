// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    LogicalGroupOverlay,
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    OperationalIntensityOverlay,
    RuntimeMicroSecondsOverlay,
    RuntimeReportOverlay,
    StaticFlopsOverlay
} from '@spcl/sdfv/src';
import {
    ICPCRequest
} from '../../../../common/messaging/icpc_messaging_component';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';

declare const vscode: any;

export class AnalysisController {

    private static readonly INSTANCE: AnalysisController =
        new AnalysisController();

    private constructor() {}

    public static getInstance(): AnalysisController {
        return this.INSTANCE;
    }

    /**
     * Fired when the value of any symbol is changed from externally.
     * @param symbol Symbol name.
     * @param value  New symbol value.
     */
    @ICPCRequest()
    public onSymbolValueChanged(symbol: string, value?: number): void {
        VSCodeRenderer.getInstance()?.get_overlay_manager()
            .on_symbol_value_changed(
                symbol, value
            );
    }

    /**
     * Fired when the heatmap scaling method is changed from externally.
     * @param method     New scaling method.
     * @param subMethod  New sub-method (e.g. number of buckets for histogram).
     */
    @ICPCRequest()
    public onHeatmapScalingChanged(method: string, subMethod?: number): void {
        const olManager = VSCodeRenderer.getInstance()?.get_overlay_manager();
        olManager?.update_heatmap_scaling_method(method);

        if (subMethod !== undefined) {
            switch (method) {
                case 'hist':
                    olManager?.update_heatmap_scaling_hist_n_buckets(subMethod);
                    break;
                case 'exponential_interpolation':
                    olManager?.update_heatmap_scaling_exp_base(subMethod);
                    break;
            }
        }
    }

    /**
     * Clear the runtime data for given runtime reports.
     * @param types Runtime report types to clear. If undefined, clear all.
     */
    @ICPCRequest()
    public async clearRuntimeReport(types?: string[]): Promise<void> {
        const olManager = VSCodeRenderer.getInstance()?.get_overlay_manager();
        if (types) {
            for (const clearType of types) {
                const rtOverlay = olManager?.get_overlay(
                    VSCodeSDFV.OVERLAYS[clearType]
                );
                if (rtOverlay && rtOverlay instanceof RuntimeReportOverlay)
                    rtOverlay.clearRuntimeData();
            }
        } else {
            for (const ol of olManager?.get_overlays() ?? []) {
                if (ol instanceof RuntimeReportOverlay)
                    ol.clearRuntimeData();
            }
        }
    }

    /**
     * Refresh the analysis side panel.
     */
    @ICPCRequest()
    public async refreshAnalysisPane(): Promise<void> {
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
                    class: 'OperationalIntensityOverlay',
                    label: 'Operational Intensity',
                    type: OperationalIntensityOverlay.type,
                },
                {
                    class: 'MemoryLocationOverlay',
                    label: 'Memory Location Intensity',
                    type: MemoryLocationOverlay.type,
                },
                {
                    class: 'LogicalGroupOverlay',
                    label: 'Logical Groups',
                    type: LogicalGroupOverlay.type,
                },
                {
                    class: 'RuntimeMicroSecondsOverlay',
                    label: 'Measured Runtime (microseconds)',
                    type: RuntimeMicroSecondsOverlay.type,
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

    /**
     * Register all current SDFG's symbols in the analysis pane.
     */
    public async analysisPaneRegisterSymbols(): Promise<void> {
        // TODO: Not called anywhere, check!!
        const symbols =
            VSCodeRenderer.getInstance()?.get_sdfg().attributes.symbols;
        if (symbols)
            return SDFVComponent.getInstance().invoke(
                'analysisAddSymbols', [symbols]
            );
    }

    /**
     * Refresh the symbols and their values in the analysis pane.
     */
    public async analysisPaneRefreshSymbols(): Promise<void> {
        // TODO: Not called anywhere, check!!
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

}
