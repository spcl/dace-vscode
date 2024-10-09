// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import $ = require('jquery');
(window as any).jQuery = $;

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-symbols';

import './analysis.css';

import { SymbolMap } from '@spcl/sdfv/src';
import {
    ICPCWebclientMessagingComponent
} from '../../messaging/icpc_webclient_messaging_component';
import {
    ICPCRequest
} from '../../../common/messaging/icpc_messaging_component';
import { ComponentTarget } from '../../../components/components';
import { OverlayType } from '@spcl/sdfv/src/overlays/generic_sdfg_overlay';

declare const vscode: any;

class SymbolResolution {

    private symbols: { [key: string]: any | undefined } = {};
    private symbolTable: JQuery<HTMLElement> | undefined = undefined;

    public constructor() {
    }

    public addSymbol(symbol: string): void {
        if (!(symbol in this.symbols)) {
            this.symbols[symbol] = undefined;
            this.updateSymbolList();
        }
    }

    public addSymbols(symbols: any): void {
        Object.keys(symbols).forEach((symbol) => {
            if (!(symbol in this.symbols))
                this.symbols[symbol] = undefined;
        });
        this.updateSymbolList();
    }

    public defineSymbol(symbol: string, definition: any): void {
        if (definition !== undefined && !isNaN(definition)) {
            this.symbols[symbol] = definition;
            this.updateSymbolList();
        }
    }

    public removeSymbolDefinition(symbol: string): void {
        if (symbol in this.symbols) {
            this.symbols[symbol] = undefined;
            this.updateSymbolList();
        }
    }

    public removeSymbol(symbol: string): void {
        if (symbol in this.symbols) {
            delete this.symbols[symbol];
            this.updateSymbolList();
        }
    }

    public removeAllSymbolDefinitions(): void {
        Object.keys(this.symbols).forEach((symbol) => {
            this.symbols[symbol] = undefined;
        });
        this.updateSymbolList();
    }

    public setSymbols(symbols: { [key: string]: any | undefined }): void {
        this.symbols = symbols;
        this.updateSymbolList();
    }

    public clearSymbols(preventUpdate: boolean = false): void {
        this.symbols = {};
        if (!preventUpdate)
            this.updateSymbolList();
    }

    public updateSymbolList(): void {
        if (this.symbolTable === undefined)
            this.symbolTable = $('#symbol-table');

        this.symbolTable.html('');
        Object.keys(this.symbols).forEach((symbol) => {
            if (this.symbolTable !== undefined) {
                const row = $('<tr>', {
                    'class': 'symbol-entry',
                }).appendTo(this.symbolTable);
                $('<td>', {
                    'class': 'symbol',
                    'html': `
                        ${symbol}
                    `,
                }).appendTo(row);
                const definitionContainer = $('<td>', {
                    'class': 'symbol-definition',
                }).appendTo(row);
                const input = $('<input>', {
                    'class': 'symbol-definition-input',
                    'type': 'number',
                    'min': '1',
                    'placeholder': 'undefined',
                }).appendTo(definitionContainer);
                if (this.symbols[symbol] !== undefined)
                    input.val(this.symbols[symbol]);
                input.on('change', (event: any) => {
                    let value = event.target.value;
                    if (value !== undefined && !isNaN(value)) {
                        if (value < 1) {
                            value = 1;
                            event.target.value = 1;
                        }
                        this.symbols[symbol] = value;
                        AnalysisPanel.symbolValueChanged(symbol, value);
                    }
                });
                $('<button>', {
                    'class': 'symbol-definition-clear btn btn-secondary btn-sm',
                    'text': 'Clear',
                    'click': () => {
                        input.val('');
                        this.symbols[symbol] = undefined;
                        AnalysisPanel.symbolValueChanged(symbol, undefined);
                    },
                }).appendTo(definitionContainer);
                let definition = this.symbols[symbol];
                if (definition !== undefined && !isNaN(definition)) {
                    definition = +definition;
                    if (definition > 0)
                        input.val(definition);
                }
            }
        });
    }

    public specializeGraph(): void {
        AnalysisPanel.specialize(this.symbols);
    }

}

class AnalysisPanel extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE: AnalysisPanel = new AnalysisPanel();

    private constructor() {
        super(ComponentTarget.Analysis);
    }

    public static getInstance(): AnalysisPanel {
        return this.INSTANCE;
    }

    private symbolResolution?: SymbolResolution;

    private noneMessage?: JQuery<HTMLElement>;
    private contents?: JQuery<HTMLElement>;

    private nodeOverlaySelect?: JQuery<HTMLSelectElement>;
    private edgeOverlaySelect?: JQuery<HTMLSelectElement>;

    private scalingMethodInput?: JQuery<HTMLSelectElement>;
    private scalingMethodHistBucketsContainer?: JQuery<HTMLElement>;
    private scalingMethodHistBucketsInput?: JQuery<HTMLInputElement>;
    private scalingMethodExpBaseContainer?: JQuery<HTMLElement>;
    private scalingMethodExpBaseInput?: JQuery<HTMLInputElement>;

    private runtimeReportFilenameLabel?: JQuery<HTMLSpanElement>;
    private runtimeTimeCriteriumSelect?: JQuery<HTMLSelectElement>;

    public get rtReportLabel(): JQuery<HTMLSpanElement> | undefined {
        return this.runtimeReportFilenameLabel;
    }

    public get rtTimeCriteriumSelect(): JQuery<HTMLSelectElement> | undefined {
        return this.runtimeTimeCriteriumSelect;
    }

    private initDOM(): void {
        this.noneMessage = $('#none-message');
        this.contents = $('#contents');

        this.nodeOverlaySelect = $('#node-overlays-input');
        this.edgeOverlaySelect = $('#edge-overlays-input');

        this.scalingMethodInput = $('#scaling-method-input');
        this.scalingMethodInput?.on('change', () => {
            this.onScalingUpdated();
        });

        this.scalingMethodHistBucketsContainer =
            $('#scaling-method-hist-buckets-container');
        this.scalingMethodHistBucketsInput =
            $('#scaling-method-hist-buckets-input');
        this.scalingMethodHistBucketsInput?.on('change', () => {
            this.onScalingUpdated();
        });

        this.scalingMethodExpBaseContainer =
            $('#scaling-method-exp-base-container');
        this.scalingMethodExpBaseInput = $('#scaling-method-exp-base-input');
        this.scalingMethodExpBaseInput?.on('change', () => {
            this.onScalingUpdated();
        });

        this.runtimeReportFilenameLabel = $('#runtime-report-filename-label');

        this.runtimeTimeCriteriumSelect = $('#runtime-time-criterium-select');
        this.runtimeTimeCriteriumSelect?.on('change', () => {
            const crit = this.runtimeTimeCriteriumSelect?.val();
            if (!crit || typeof crit !== 'string')
                return;
            AnalysisPanel.instrumentationReportChangeCriterium(crit);
        });

        $('#specialize-btn').on('click', () => {
            this.symbolResolution?.specializeGraph();
        });

        $('#runtime-report-clear-btn').on('click', () => {
            this.clearRuntimeReport();
        });
        $('#runtime-report-browse-btn').on('click', () => {
            this.invoke('selectReportFile').then(retval => {
                const aPanel = AnalysisPanel.getInstance();
                if (retval.data && retval.path) {
                    const splits = retval.path.path.split('/');
                    const filename = splits[splits.length - 1];
                    aPanel.rtReportLabel?.val(filename);
                    aPanel.rtReportLabel?.prop('title', retval.path.fsPath);
                    const rtSelCrit = aPanel.rtTimeCriteriumSelect?.val();
                    if (!rtSelCrit || typeof rtSelCrit !== 'string')
                        return;
                    AnalysisPanel.onLoadInstrumentationReport(
                        retval.data, rtSelCrit
                    );
                }
            });
        });
    }

    public init(): void {
        super.init(vscode, window);

        this.initDOM();

        this.symbolResolution = new SymbolResolution();

        this.register(
            this.symbolResolution.addSymbol, this.symbolResolution
        );
        this.register(
            this.symbolResolution.addSymbols, this.symbolResolution
        );
        this.register(
            this.symbolResolution.defineSymbol, this.symbolResolution
        );
        this.register(
            this.symbolResolution.removeSymbolDefinition, this.symbolResolution
        );
        this.register(
            this.symbolResolution.removeAllSymbolDefinitions,
            this.symbolResolution
        );
        this.register(
            this.symbolResolution.removeSymbol, this.symbolResolution
        );

        this.invoke('onReady');
    }

    @ICPCRequest()
    public clear(reason?: string): void {
        this.symbolResolution?.clearSymbols();
        this.contents?.hide();
        if (reason)
            this.noneMessage?.text(reason);
        else
            this.noneMessage?.text('No analysis available');
        this.noneMessage?.show();
    }

    @ICPCRequest()
    public updateAnalysisPane(
        activeOverlays: any[], symbols: any, scalingMethod?: string,
        scalingSubMethod?: string, availableOverlays?: any[]
    ): void {
        if (scalingMethod !== undefined) {
            this.scalingMethodInput?.val(scalingMethod);
            if (scalingSubMethod !== undefined) {
                switch (scalingSubMethod) {
                    case 'hist':
                        this.scalingMethodHistBucketsContainer?.show();
                        this.scalingMethodExpBaseContainer?.hide();
                        break;
                    case 'exponential_interpolation':
                        this.scalingMethodHistBucketsContainer?.hide();
                        this.scalingMethodExpBaseContainer?.show();
                        break;
                    default:
                        this.scalingMethodHistBucketsContainer?.hide();
                        this.scalingMethodExpBaseContainer?.hide();
                        break;
                }
            }
        }


        if (availableOverlays !== undefined) {
            this.nodeOverlaySelect?.html('');
            this.edgeOverlaySelect?.html('');

            this.nodeOverlaySelect?.append(new Option('None', 'none', true));
            this.edgeOverlaySelect?.append(new Option('None', 'none', true));

            for (const overlay of availableOverlays) {
                const option = new Option(
                    overlay.label, overlay.class, false,
                    activeOverlays.includes(overlay.class)
                );
                switch (overlay.type) {
                    case OverlayType.BOTH:
                        // TODO(later): Not an issue yet, but once we have
                        // overlays that are of type both, this must be
                        // considered.
                    case OverlayType.NODE:
                        this.nodeOverlaySelect?.append(option);
                        break;
                    case OverlayType.EDGE:
                        this.edgeOverlaySelect?.append(option);
                        break;
                }
            }

            const updateHandler = () => {
                const overlays = [];
                const nodeOverlay = this.nodeOverlaySelect?.val();
                if (nodeOverlay && nodeOverlay !== 'none' &&
                    typeof nodeOverlay === 'string')
                    overlays.push(nodeOverlay);
                const edgeOverlay = this.edgeOverlaySelect?.val();
                if (edgeOverlay && edgeOverlay !== 'none' &&
                    typeof edgeOverlay === 'string')
                    overlays.push(edgeOverlay);

                if (nodeOverlay?.toString().startsWith('Runtime')) {
                    $('#runtime-measurement-divider').show();
                    $('#runtime-measurement').show();
                } else {
                    $('#runtime-measurement-divider').hide();
                    $('#runtime-measurement').hide();
                }

                AnalysisPanel.setOverlays(overlays);
            };

            this.nodeOverlaySelect?.on('change', updateHandler);
            this.edgeOverlaySelect?.on('change', updateHandler);
        }

        this.setSymbols(symbols);
    }

    @ICPCRequest()
    public setSymbols(newSymbols: any): void {
        if (newSymbols !== undefined) {
            const symbols: SymbolMap = {};
            Object.keys(newSymbols).forEach((symbol) => {
                if (newSymbols[symbol] === '')
                    symbols[symbol] = undefined;
                else
                    symbols[symbol] = newSymbols[symbol];
            });
            this.symbolResolution?.setSymbols(symbols);
        }

        this.noneMessage?.hide();
        this.contents?.show();
    }

    public clearRuntimeReport(): void {
        this.runtimeReportFilenameLabel?.val('Load runtime report');
        this.runtimeReportFilenameLabel?.prop('title', '');
        const nodeType = this.nodeOverlaySelect?.val();
        const edgeType = this.edgeOverlaySelect?.val();
        const clearTypes = [];
        if (nodeType && typeof nodeType === 'string' && nodeType !== 'none')
            clearTypes.push(nodeType);
        if (edgeType && typeof edgeType === 'string' && edgeType !== 'none')
            clearTypes.push(edgeType);
        AnalysisPanel.clearRuntimeReport(clearTypes);
    }

    public onScalingUpdated(): void {
        const scalingMethod = this.scalingMethodInput?.val();
        if (!scalingMethod || typeof scalingMethod !== 'string')
            return;

        let additionalVal: number | undefined = undefined;
        let tmpVal: any = undefined;
        switch (scalingMethod) {
            case 'hist':
                this.scalingMethodHistBucketsContainer?.show();
                this.scalingMethodExpBaseContainer?.hide();
                tmpVal = this.scalingMethodHistBucketsInput?.val();
                try {
                    if (typeof tmpVal === 'string')
                        additionalVal = parseInt(tmpVal);
                    else if (typeof additionalVal === 'number')
                        additionalVal = tmpVal;
                    else
                        additionalVal = 0;
                } catch (_) {
                    additionalVal = 0;
                }
                break;
            case 'exponential_interpolation':
                this.scalingMethodHistBucketsContainer?.hide();
                this.scalingMethodExpBaseContainer?.show();
                tmpVal = this.scalingMethodExpBaseInput?.val();
                try {
                    if (typeof tmpVal === 'string')
                        additionalVal = parseInt(tmpVal);
                    else if (typeof additionalVal === 'number')
                        additionalVal = tmpVal;
                    else
                        additionalVal = 2;
                } catch (_) {
                    additionalVal = 2;
                }
                break;
            default:
                this.scalingMethodHistBucketsContainer?.hide();
                this.scalingMethodExpBaseContainer?.hide();
                break;
        }

        AnalysisPanel.updateScalingMethod(scalingMethod, additionalVal);
    }

    @ICPCRequest()
    public onAutoloadReport(path: string): string {
        this.runtimeReportFilenameLabel?.val(path);
        this.runtimeReportFilenameLabel?.prop('title', path);
        const crit = this.runtimeTimeCriteriumSelect?.val();
        if (crit && typeof crit === 'string')
            return crit;
        return 'med';
    }

    public static async symbolValueChanged(
        symbol: string, value?: number
    ): Promise<void> {
        return this.INSTANCE.invokeEditorProcedure(
            'onSymbolValueChanged', [symbol, value]
        );
    }

    public static async specialize(valueMap: SymbolMap): Promise<void> {
        return this.INSTANCE.invokeEditorProcedure('specialize', [valueMap]);
    }

    public static async onLoadInstrumentationReport(
        report: any, crit: string
    ): Promise<void> {
        return this.INSTANCE.invokeEditorProcedure(
            'loadInstrumentationReport', [report, crit]
        );
    }

    public static async instrumentationReportChangeCriterium(
        criterium: string
    ): Promise<void> {
        return this.INSTANCE.invokeEditorProcedure(
            'setInstrumentationReportCriterium', [criterium]
        );
    }

    public static async updateScalingMethod(
        method: string, subMethod?: number
    ): Promise<void> {
        return this.INSTANCE.invokeEditorProcedure(
            'onHeatmapScalingChanged', [method, subMethod]
        );
    }

    public static async setOverlays(overlays: string[]): Promise<void> {
        return this.INSTANCE.invokeEditorProcedure('setOverlays', [overlays]);
    }

    public static async clearRuntimeReport(types?: string[]): Promise<void> {
        return this.INSTANCE.invokeEditorProcedure(
            'clearRuntimeReport', [types]
        );
    }

}

$(() => {
    ($('[data-bs-toggle="tooltip"') as any)?.tooltip();

    AnalysisPanel.getInstance().init();
});
