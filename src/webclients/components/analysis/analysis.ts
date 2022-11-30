// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as $ from 'jquery';
(window as any).jQuery = $;

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import './analysis.css';

import { OverlayType, SymbolMap } from '@spcl/sdfv/out';
import {
    ICPCWebclientMessagingComponent
} from '../../messaging/icpc_webclient_messaging_component';
import { ICPCRequest } from '../../../common/messaging/icpc_messaging_component';

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

    public clearSymbols(): void {
        this.symbols = {};
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
                        AnalysisPanel.getInstance().invoke(
                            'symbolValueChanged', [symbol, value]
                        );
                    }
                });
                $('<button>', {
                    'class': 'symbol-definition-clear btn btn-secondary btn-sm',
                    'text': 'Clear',
                    'click': () => {
                        input.val('');
                        this.symbols[symbol] = undefined;
                        AnalysisPanel.getInstance().invoke(
                            'symbolValueChanged', [symbol, undefined]
                        );
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
        AnalysisPanel.getInstance().invoke(
            'specialize', [this.symbols]
        );
    }

}

class AnalysisPanel extends ICPCWebclientMessagingComponent {

    private static readonly INSTANCE: AnalysisPanel = new AnalysisPanel();

    private constructor() {
        super();
    }

    public static getInstance(): AnalysisPanel {
        return this.INSTANCE;
    }

    private symbolResolution?: SymbolResolution;

    private noneMessage?: JQuery<HTMLElement>;
    private contents?: JQuery<HTMLElement>;
    private overlayToggles?: JQuery<HTMLElement>;

    public init(): void {
        super.init(vscode, window);

        this.symbolResolution = new SymbolResolution();

        this.noneMessage = $('#none-message');
        this.contents = $('#contents');
        this.overlayToggles = $('#overlay-toggles');
        $('#specialize-btn').on('click', () => {
            this.symbolResolution?.specializeGraph();
        });

        $('#scaling-method-input').on('change', this.onScalingUpdated);
        $('#scaling-method-hist-buckets-input').on(
            'change', this.onScalingUpdated
        );
        $('#scaling-method-exp-base-input').on('change', this.onScalingUpdated);

        $('#runtime-report-file-input').on('change', function () {
            const fr = new FileReader();
            const that = this as HTMLInputElement;
            fr.onload = () => {
                if (fr && that.files) {
                    const rtReportLabel = $('#runtime-report-filename-label');
                    rtReportLabel.val(that.files[0].name);
                    rtReportLabel.prop('title', (that.files[0] as any).path);
                    const cb = $(
                        'input[type="checkbox"][value="StaticFlopsOverlay"]'
                    );
                    cb.prop('checked', false);
                    cb.prop('disabled', true);
                    if (fr.result && typeof fr.result === 'string')
                        AnalysisPanel.getInstance().invoke(
                            'onLoadInstrumentationReport',
                            [
                                JSON.parse(fr.result),
                                $('#runtime-time-criterium-select').val(),
                            ]
                        );
                }
            };
            if (that.files)
                fr.readAsText(that.files[0]);
        });

        $('#runtime-time-criterium-select').on('change', () => {
            this.invoke(
                'instrumentationReportChangeCriterium',
                [$('#runtime-time-criterium-select').val()]
            );
        });

        $('#runtime-report-clear-btn').on('click', this.clearRuntimeReport);

        $('#runtime-report-browse-btn').on('click', () => {
            $('#runtime-report-file-input').trigger('click');
        });

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

        this.invoke('refresh');
    }

    @ICPCRequest()
    public clear(reason?: string): void {
        this.symbolResolution?.clearSymbols();
        this.overlayToggles?.html('');
        $('input[type=radio][value=median]').prop('checked', true);
        this.contents?.hide();
        if (reason)
            this.noneMessage?.text(reason);
        else
            this.noneMessage?.text('No analysis available');
        this.noneMessage?.show();
    }

    @ICPCRequest()
    public refresh(
        activeOverlays: any[], symbols: any, scalingMethod?: string,
        scalingSubMethod?: string, availableOverlays?: any[]
    ): void {
        if (scalingMethod !== undefined) {
            $('#scaling-method-input').val(scalingMethod);

            if (scalingSubMethod !== undefined) {
                switch (scalingSubMethod) {
                    case 'hist':
                        $('#scaling-method-hist-buckets-container')
                            .show();
                        break;
                    case 'exponential_interpolation':
                        $('#scaling-method-exp-base-container').show();
                        break;
                    default:
                        $('#scaling-method-exp-base-container').hide();
                        $('#scaling-method-hist-buckets-container')
                            .hide();
                        break;
                }
            }
        }


        if (availableOverlays !== undefined) {
            const nodeOverlaySelect = $('#node-overlays-input');
            const edgeOverlaySelect = $('#edge-overlays-input');

            nodeOverlaySelect.html('');
            edgeOverlaySelect.html('');

            nodeOverlaySelect.append(new Option('None', 'none', true));
            edgeOverlaySelect.append(new Option('None', 'none', true));

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
                        nodeOverlaySelect.append(option);
                        break;
                    case OverlayType.EDGE:
                        edgeOverlaySelect.append(option);
                        break;
                }
            }

            const updateHandler = () => {
                const overlays = [];
                if (nodeOverlaySelect.val() !== 'none')
                    overlays.push(nodeOverlaySelect.val());
                if (edgeOverlaySelect.val() !== 'none')
                    overlays.push(edgeOverlaySelect.val());
                this.invoke('setOverlays', [overlays]);
            };

            nodeOverlaySelect.on('change', updateHandler);
            edgeOverlaySelect.on('change', updateHandler);
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
        $('#runtime-report-file-input').val('');
        const rtReportLabel = $('#runtime-report-filename-label');
        rtReportLabel.val('Load runtime report');
        rtReportLabel.prop('title', '');
        $('input[type="checkbox"][value="daceStaticFlopsOverlay"]').prop(
            'disabled', false
        );
        this.invoke('clearRuntimeReport');
    }

    public onScalingUpdated(): void {
        const scalingMethod = $('#scaling-method-input').val();
        let additionalVal = undefined;
        switch (scalingMethod) {
            case 'hist':
                $('#scaling-method-hist-buckets-container').show();
                $('#scaling-method-exp-base-container').hide();
                additionalVal = $('#scaling-method-hist-buckets-input').val();
                break;
            case 'exponential_interpolation':
                $('#scaling-method-hist-buckets-container').hide();
                $('#scaling-method-exp-base-container').show();
                additionalVal = $('#scaling-method-exp-base-input').val();
                break;
            default:
                $('#scaling-method-exp-base-container').hide();
                $('#scaling-method-hist-buckets-container').hide();
                break;
        }

        this.invoke(
            'updateScalingMethod', [scalingMethod, additionalVal]
        );
    }

    @ICPCRequest()
    public onAutoloadReport(path: string): string {
        const cb = $('input[type="checkbox"][value="daceStaticFlopsOverlay"]');
        const rtReportLabel = $('#runtime-report-filename-label');
        rtReportLabel.val(path);
        rtReportLabel.prop('title', path);
        cb.prop('checked', false);
        cb.prop('disabled', true);
        const crit = $('#runtime-time-criterium-select').val();
        if (crit && typeof crit === 'string')
            return crit;
        return 'med';
    }

}

$(() => {
    ($('[data-bs-toggle="tooltip"') as any)?.tooltip();

    AnalysisPanel.getInstance().init();
});
