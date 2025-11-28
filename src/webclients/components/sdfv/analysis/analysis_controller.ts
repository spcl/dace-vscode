// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    LogicalGroupOverlay,
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    OperationalIntensityOverlay,
    SimulatedOperationalIntensityOverlay,
    RuntimeMicroSecondsOverlay,
    SDFGRenderer,
    StaticFlopsOverlay,
    DepthOverlay,
    AvgParallelismOverlay,
    RuntimeReportOverlay,
} from '@spcl/sdfv/src';
import {
    ICPCRequest,
} from '../../../../common/messaging/icpc_messaging_component';
import { VSCodeRenderer } from '../renderer/vscode_renderer';
import { SDFVComponent, VSCodeSDFV } from '../vscode_sdfv';
import { ComponentTarget } from '../../../../components/components';
import { IOverlayDescription } from '../../../../types';

declare const vscode: any;

export class AnalysisController {

    private static readonly INSTANCE: AnalysisController =
        new AnalysisController();

    private constructor() {
        return;
    }

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
        VSCodeRenderer.getInstance()?.overlayManager.onSymbolValueChanged(
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
        const olManager = VSCodeRenderer.getInstance()?.overlayManager;
        if (!olManager)
            return;

        olManager.heatmapScalingMethod = method;

        if (subMethod !== undefined) {
            switch (method) {
                case 'hist':
                    olManager.heatmapScalingHistNBuckets = subMethod;
                    break;
                case 'exponential_interpolation':
                    olManager.heatmapScalingExpBase = subMethod;
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
        sdfv.onLoadedRuntimeReport(report, sdfv.renderer);
        this.setInstrumentationReportCriterium(criterium, sdfv.renderer);
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
        const overlays = rend?.overlayManager.overlays;
        for (const ol of overlays ?? []) {
            if (ol instanceof RuntimeReportOverlay) {
                ol.criterium = criterium;
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
        const olManager = VSCodeRenderer.getInstance()?.overlayManager;
        if (types) {
            for (const clearType of types) {
                const rtOverlay = olManager?.getOverlay(
                    VSCodeSDFV.OVERLAYS[clearType]
                );
                if (rtOverlay && rtOverlay instanceof RuntimeReportOverlay)
                    rtOverlay.clearRuntimeData();
            }
        } else {
            for (const ol of olManager?.overlays ?? []) {
                if (ol instanceof RuntimeReportOverlay)
                    ol.clearRuntimeData();
            }
        }
    }

    /**
     * Refresh the analysis side panel.
     */
    @ICPCRequest()
    public refreshAnalysisPane(): void {
        const renderer = VSCodeRenderer.getInstance();
        if (renderer !== null && vscode !== undefined) {
            const overlayManager = renderer.overlayManager;
            const symbolResolver = overlayManager.symbolResolver;
            symbolResolver.removeStaleSymbols();
            const map = symbolResolver.symbolValueMap;

            const activeOverlays = [];
            for (const activeOverlay of overlayManager.overlays)
                activeOverlays.push(activeOverlay.constructor.name);

            let additionalMethodVal = undefined;
            switch (overlayManager.heatmapScalingMethod) {
                case 'hist':
                    additionalMethodVal =
                        overlayManager.heatmapScalingHistNBuckets;
                    break;
                case 'exponential_interpolation':
                    additionalMethodVal = overlayManager.heatmapScalingExpBase;
                    break;
            }

            const symbols: Record<string, number | undefined | string> = {};
            Object.keys(map).forEach((symbol) => {
                symbols[symbol] = map[symbol] ?? '';
            });
            const availableOverlays: IOverlayDescription[] = [
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
            SDFVComponent.getInstance().invoke(
                'updateAnalysisPane', [
                    activeOverlays,
                    symbols,
                    overlayManager.heatmapScalingMethod,
                    additionalMethodVal,
                    availableOverlays,
                ], ComponentTarget.Analysis
            ).catch(console.error);
        }
    }

}
