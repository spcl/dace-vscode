// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    instrumentation_report_read_complete,
    LogicalGroupOverlay,
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    OperationalIntensityOverlay,
    SimulatedOperationalIntensityOverlay,
    RuntimeMicroSecondsOverlay,
    RuntimeReportOverlay,
    SDFGRenderer,
    StaticFlopsOverlay,
    DepthOverlay,
    AvgParallelismOverlay
} from '@spcl/sdfv/src';
import {
    ICPCRequest
} from '../../../../common/messaging/icpc_messaging_component';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';
import { ComponentTarget } from '../../../../components/components';

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
     * Load new data for the active runtime overlays.
     * @param report    New report to be loaded.
     * @param criterium Selection criterium to use.
     */
    @ICPCRequest()
    public loadInstrumentationReport(
        report: { traceEvents: any[] }, criterium: string
    ): void {
        const sdfv = VSCodeSDFV.getInstance();
        const renderer = sdfv.get_renderer() ?? undefined;
        instrumentation_report_read_complete(sdfv, report, renderer);
        this.setInstrumentationReportCriterium(criterium, renderer);
    }

    /**
     * Update the selection criterium for active runtime overlays.
     * @param criterium New criterium to use.
     * @param renderer  Renderer on which to update overlays.
     */
    @ICPCRequest()
    public setInstrumentationReportCriterium(
        criterium: string, renderer?: SDFGRenderer
    ): void {
        const rend = renderer ?? VSCodeRenderer.getInstance();
        const overlays = rend?.get_overlay_manager().get_overlays();
        for (const ol of overlays ?? []) {
            if (ol instanceof RuntimeReportOverlay) {
                ol.set_criterium(criterium);
                ol.refresh();
            }
        }
    }

    /**
     * Clear the runtime data for given runtime reports.
     * @param types Runtime report types to clear. If undefined, clear all.
     */
    @ICPCRequest()
    public clearRuntimeReport(types?: string[]): void {
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
            symbolResolver?.removeStaleSymbols();
            const map = symbolResolver?.get_symbol_value_map();

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

            const symbols: { [sym: string]: number | undefined | string } = {};
            Object.keys(map).forEach((symbol) => {
                symbols[symbol] = map[symbol] ?? '';
            });
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
                    class: 'DepthOverlay',
                    label: 'Depth',
                    type: DepthOverlay.type,
                },
                {
                    class: 'AvgParallelismOverlay',
                    label: 'Average Parallelism',
                    type: AvgParallelismOverlay.type,
                },
                {
                    class: 'OperationalIntensityOverlay',
                    label: 'Operational Intensity',
                    type: OperationalIntensityOverlay.type,
                },
                {
                    class: 'SimulatedOperationalIntensityOverlay',
                    label: 'Simulated Operational Intensity',
                    type: SimulatedOperationalIntensityOverlay.type,
                },
                {
                    class: 'MemoryLocationOverlay',
                    label: 'Memory Location',
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
                'updateAnalysisPane', [
                    activeOverlays,
                    symbols,
                    overlayManager.get_heatmap_scaling_method(),
                    additionalMethodVal,
                    availableOverlays
                ], ComponentTarget.Analysis
            );
        }
    }

}
