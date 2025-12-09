// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import $ from 'jquery';

import * as bootstrap from 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-symbols';

import './analysis.css';

import { OverlayType, SymbolMap } from '@spcl/sdfv/src';
import {
    ICPCWebclientMessagingComponent,
} from '../../messaging/icpc_webclient_messaging_component';
import {
    ICPCRequest,
} from '../../../common/messaging/icpc_messaging_component';
import { ComponentTarget } from '../../../components/components';
import type { Uri } from 'vscode';
import type { WebviewApi } from 'vscode-webview';
import { IOverlayDescription } from '../../../types';


declare const vscode: WebviewApi<unknown>;

class SymbolResolution {

    private symbols: Record<string, number | undefined> = {};
    private symbolTable: JQuery | undefined = undefined;

    public addSymbol(symbol: string): void {
        if (!(symbol in this.symbols)) {
            this.symbols[symbol] = undefined;
            this.updateSymbolList();
        }
    }

    public addSymbols(symbols: object): void {
        Object.keys(symbols).forEach((symbol) => {
            if (!(symbol in this.symbols))
                this.symbols[symbol] = undefined;
        });
        this.updateSymbolList();
    }

    public defineSymbol(symbol: string, definition?: number): void {
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

    public setSymbols(symbols: Record<string, number | undefined>): void {
        this.symbols = symbols;
        this.updateSymbolList();
    }

    public clearSymbols(preventUpdate: boolean = false): void {
        this.symbols = {};
        if (!preventUpdate)
            this.updateSymbolList();
    }

    public updateSymbolList(): void {
        this.symbolTable ??= $('#symbol-table');

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
                input.on('change', event => {
                    let value = +(event.target as HTMLInputElement).value;
                    if (!isNaN(value)) {
                        if (value < 1) {
                            value = 1;
                            (event.target as HTMLInputElement).value = '1';
                        }
                        this.symbols[symbol] = value;
                        void AnalysisPanel.symbolValueChanged(symbol, value);
                    }
                });
                $('<button>', {
                    'class': 'symbol-definition-clear btn btn-secondary btn-sm',
                    'text': 'Clear',
                    'click': () => {
                        input.val('');
                        this.symbols[symbol] = undefined;
                        void AnalysisPanel.symbolValueChanged(
                            symbol, undefined
                        );
                    },
                }).appendTo(definitionContainer);
                const definition = this.symbols[symbol];
                if (definition !== undefined && !isNaN(definition)) {
                    if (definition > 0)
                        input.val(definition);
                }
            }
        });
    }

    public specializeGraph(): void {
        void AnalysisPanel.specialize(this.symbols);
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

    private noneMessage?: JQuery;
    private contents?: JQuery;

    private nodeOverlaySelect?: JQuery<HTMLSelectElement>;
    private edgeOverlaySelect?: JQuery<HTMLSelectElement>;

    private scalingMethodInput?: JQuery<HTMLSelectElement>;
    private scalingMethodHistBucketsContainer?: JQuery;
    private scalingMethodHistBucketsInput?: JQuery<HTMLInputElement>;
    private scalingMethodExpBaseContainer?: JQuery;
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
        this.scalingMethodInput.on('change', () => {
            this.onScalingUpdated();
        });

        this.scalingMethodHistBucketsContainer =
            $('#scaling-method-hist-buckets-container');
        this.scalingMethodHistBucketsInput =
            $('#scaling-method-hist-buckets-input');
        this.scalingMethodHistBucketsInput.on('change', () => {
            this.onScalingUpdated();
        });

        this.scalingMethodExpBaseContainer =
            $('#scaling-method-exp-base-container');
        this.scalingMethodExpBaseInput = $('#scaling-method-exp-base-input');
        this.scalingMethodExpBaseInput.on('change', () => {
            this.onScalingUpdated();
        });

        this.runtimeReportFilenameLabel = $('#runtime-report-filename-label');

        this.runtimeTimeCriteriumSelect = $('#runtime-time-criterium-select');
        this.runtimeTimeCriteriumSelect.on('change', () => {
            const crit = this.runtimeTimeCriteriumSelect?.val();
            if (!crit || typeof crit !== 'string')
                return;
            void AnalysisPanel.instrumentationReportChangeCriterium(crit);
        });

        $('#specialize-btn').on('click', () => {
            this.symbolResolution?.specializeGraph();
        });

        $('#runtime-report-clear-btn').on('click', () => {
            this.clearRuntimeReport();
        });
        $('#runtime-report-browse-btn').on('click', () => {
            void this.invoke<{
                data?: string,
                path?: Uri,
            }>('selectReportFile').then(retval => {
                const aPanel = AnalysisPanel.getInstance();
                if (retval.data && retval.path) {
                    const splits = retval.path.path.split('/');
                    const filename = splits[splits.length - 1];
                    aPanel.rtReportLabel?.val(filename);
                    aPanel.rtReportLabel?.prop('title', retval.path.fsPath);
                    const rtSelCrit = aPanel.rtTimeCriteriumSelect?.val();
                    if (!rtSelCrit || typeof rtSelCrit !== 'string')
                        return;
                    void AnalysisPanel.onLoadInstrumentationReport(
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
            this.symbolResolution.addSymbol.bind(this.symbolResolution),
            this.symbolResolution
        );
        this.register(
            this.symbolResolution.addSymbols.bind(this.symbolResolution),
            this.symbolResolution
        );
        this.register(
            this.symbolResolution.defineSymbol.bind(this.symbolResolution),
            this.symbolResolution
        );
        this.register(
            this.symbolResolution.removeSymbolDefinition.bind(
                this.symbolResolution
            ), this.symbolResolution
        );
        this.register(
            this.symbolResolution.removeAllSymbolDefinitions.bind(
                this.symbolResolution
            ), this.symbolResolution
        );
        this.register(
            this.symbolResolution.removeSymbol.bind(this.symbolResolution),
            this.symbolResolution
        );

        void this.invoke('onReady');
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
        activeOverlays: string[],
        symbols: Record<string, string | number | undefined>,
        scalingMethod?: string,
        scalingSubMethod?: string, availableOverlays?: IOverlayDescription[]
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

                void AnalysisPanel.setOverlays(overlays);
            };

            this.nodeOverlaySelect?.on('change', updateHandler);
            this.edgeOverlaySelect?.on('change', updateHandler);
        }

        this.setSymbols(symbols);
    }

    @ICPCRequest()
    public setSymbols(
        newSymbols?: Record<string, string | number | undefined>
    ): void {
        if (newSymbols !== undefined) {
            const symbols: SymbolMap = {};
            Object.keys(newSymbols).forEach((symbol) => {
                if (newSymbols[symbol] === '')
                    symbols[symbol] = undefined;
                else if (newSymbols[symbol] === undefined)
                    symbols[symbol] = undefined;
                else
                    symbols[symbol] = +newSymbols[symbol];
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
        void AnalysisPanel.clearRuntimeReport(clearTypes);
    }

    public onScalingUpdated(): void {
        const scalingMethod = this.scalingMethodInput?.val();
        if (!scalingMethod || typeof scalingMethod !== 'string')
            return;

        let additionalVal: number | undefined = undefined;
        let tmpVal: string | number | undefined = undefined;
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

        void AnalysisPanel.updateScalingMethod(scalingMethod, additionalVal);
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
    ): Promise<any> {
        return this.INSTANCE.invokeEditorProcedure(
            'onSymbolValueChanged', [symbol, value]
        );
    }

    public static async specialize(valueMap: SymbolMap): Promise<any> {
        return this.INSTANCE.invokeEditorProcedure('specialize', [valueMap]);
    }

    public static async onLoadInstrumentationReport(
        report: any, crit: string
    ): Promise<any> {
        return this.INSTANCE.invokeEditorProcedure(
            'loadInstrumentationReport', [report, crit]
        );
    }

    public static async instrumentationReportChangeCriterium(
        criterium: string
    ): Promise<any> {
        return this.INSTANCE.invokeEditorProcedure(
            'setInstrumentationReportCriterium', [criterium]
        );
    }

    public static async updateScalingMethod(
        method: string, subMethod?: number
    ): Promise<any> {
        return this.INSTANCE.invokeEditorProcedure(
            'onHeatmapScalingChanged', [method, subMethod]
        );
    }

    public static async setOverlays(overlays: string[]): Promise<any> {
        return this.INSTANCE.invokeEditorProcedure('setOverlays', [overlays]);
    }

    public static async clearRuntimeReport(types?: string[]): Promise<any> {
        return this.INSTANCE.invokeEditorProcedure(
            'clearRuntimeReport', [types]
        );
    }

}

$(() => {
    new bootstrap.Tooltip('[data-bs-toggle="tooltip"]');
    AnalysisPanel.getInstance().init();
});
