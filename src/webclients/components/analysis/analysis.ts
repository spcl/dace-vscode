// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as $ from 'jquery';
(window as any).jQuery = $;

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

import 'material-icons/iconfont/material-icons.css';

import './analysis.css';

import { OverlayType, SymbolMap } from '@spcl/sdfv/out';

declare const vscode: any;

let symbolResolution: SymbolResolution | null = null;

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
                        vscode.postMessage({
                            type: 'sdfv.symbol_value_changed',
                            symbol: symbol,
                            value: value,
                        });
                    }
                });
                $('<button>', {
                    'class': 'symbol-definition-clear btn btn-secondary btn-sm',
                    'text': 'Clear',
                    'click': () => {
                        input.val('');
                        this.symbols[symbol] = undefined;
                        vscode.postMessage({
                            type: 'sdfv.symbol_value_changed',
                            symbol: symbol,
                            value: undefined,
                        });
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

}

function clearRuntimeReport() {
    $('#runtime-report-file-input').val('');
    const rtReportLabel = $('#runtime-report-filename-label');
    rtReportLabel.val('Load runtime report');
    rtReportLabel.prop('title', '');
    $('input[type="checkbox"][value="daceStaticFlopsOverlay"]').prop(
        'disabled', false
    );
    if (vscode)
        vscode.postMessage({
            type: 'sdfv.clear_instrumentation_report',
        });
}

function onScalingUpdated(): void {
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

    if (vscode)
        vscode.postMessage({
            type: 'sdfv.update_heatmap_scaling_method',
            method: scalingMethod,
            additionalVal: additionalVal,
        });
}

$(() => {
    ($('[data-bs-toggle="tooltip"') as any)?.tooltip();

    symbolResolution = new SymbolResolution();

    // Add a listener to receive messages from the extension.
    window.addEventListener('message', e => {
        const message = e.data;
        switch (message.type) {
            case 'add_symbol':
                if (message.symbol !== undefined)
                    symbolResolution?.addSymbol(message.symbol);
                break;
            case 'add_symbols':
                if (message.symbols !== undefined)
                    symbolResolution?.addSymbol(message.symbols);
                break;
            case 'define_symbol':
                if (message.symbol !== undefined)
                    symbolResolution?.defineSymbol(
                        message.symbol,
                        message.definition
                    );
                break;
            case 'remove_symbol_definition':
                if (message.symbol !== undefined)
                    symbolResolution?.removeSymbolDefinition(
                        message.symbol
                    );
                break;
            case 'remove_symbol':
                if (message.symbol !== undefined)
                    symbolResolution?.removeSymbol(message.symbol);
                break;
            case 'remove_all_symbol_definitions':
                symbolResolution?.removeAllSymbolDefinitions();
                break;
            case 'refresh_analysis_pane':
                if (message.heatmapScalingMethod !== undefined) {
                    $('#scaling-method-input').val(
                        message.heatmapScalingMethod
                    );

                    if (message.heatmapScalingAdditionalVal !== undefined) {
                        switch (message.heatmapScalingMethod) {
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


                if (message.availableOverlays !== undefined) {
                    const nodeOverlaySelect = $('#node-overlays-input');
                    const edgeOverlaySelect = $('#edge-overlays-input');

                    nodeOverlaySelect.html('');
                    edgeOverlaySelect.html('');

                    nodeOverlaySelect.append(new Option('None', 'none', true));
                    edgeOverlaySelect.append(new Option('None', 'none', true));

                    for (const overlay of message.availableOverlays) {
                        const option = new Option(
                            overlay.label, overlay.class, false,
                            message.activeOverlays.includes(overlay.class)
                        );
                        switch (overlay.type) {
                            case OverlayType.BOTH:
                                // TODO(later): Not an issue yet, but once
                                // we have overlays that are of type both,
                                // this must be considered.
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
                        console.log(overlays);
                        vscode.postMessage({
                            type: 'sdfv.set_overlays',
                            overlays: overlays,
                        });
                    };

                    nodeOverlaySelect.on('change', updateHandler);
                    edgeOverlaySelect.on('change', updateHandler);
                }
                // Fall through into the next case to also set the symbols.
            case 'set_symbols':
                if (message.symbols !== undefined) {
                    const symbols: SymbolMap = {};
                    Object.keys(message.symbols).forEach((symbol) => {
                        if (message.symbols[symbol] === '')
                            symbols[symbol] = undefined;
                        else
                            symbols[symbol] = message.symbols[symbol];
                    });
                    symbolResolution?.setSymbols(symbols);
                }

                $('#none-message').hide();
                $('#contents').show();
                break;
            case 'clear':
                symbolResolution?.clearSymbols();
                $('#overlay-toggles').html('');
                $('input[type=radio][value=median]').prop('checked', true);
                $('#contents').hide();
                const noneMessage = $('#none-message');
                if (message.reason)
                    noneMessage.text(message.reason);
                else
                    noneMessage.text('No analysis available');
                noneMessage.show();
                break;
            case 'autoload_report':
                const cb = $(
                    'input[type="checkbox"][value="daceStaticFlopsOverlay"]'
                );
                const rtReportLabel = $('#runtime-report-filename-label');
                rtReportLabel.val(message.path);
                rtReportLabel.prop('title', message.path);
                cb.prop('checked', false);
                cb.prop('disabled', true);
                vscode.postMessage({
                    type: 'sdfv.load_instrumentation_report',
                    result: message.json,
                    criterium: $('#runtime-time-criterium-select').val(),
                });
                break;
            default:
                break;
        }
    });

    $('#scaling-method-input').on('change', onScalingUpdated);
    $('#scaling-method-hist-buckets-input').on('change', onScalingUpdated);
    $('#scaling-method-exp-base-input').on('change', onScalingUpdated);

    $('#runtime-report-file-input').on('change', function () {
        const fr = new FileReader();
        const that = this as HTMLInputElement;
        fr.onload = () => {
            if (fr && vscode && that.files) {
                const rtReportLabel = $('#runtime-report-filename-label');
                rtReportLabel.val(that.files[0].name);
                rtReportLabel.prop('title', (that.files[0] as any).path);
                const cb = $(
                    'input[type="checkbox"][value="StaticFlopsOverlay"]'
                );
                cb.prop('checked', false);
                cb.prop('disabled', true);
                if (fr.result && typeof fr.result === 'string')
                    vscode.postMessage({
                        type: 'sdfv.load_instrumentation_report',
                        result: JSON.parse(fr.result),
                        criterium: $('#runtime-time-criterium-select').val(),
                    });
            }
        };
        if (that.files)
            fr.readAsText(that.files[0]);
    });

    $('#runtime-time-criterium-select').change(() => {
        if (vscode)
            vscode.postMessage({
                type: 'sdfv.instrumentation_report_change_criterium',
                criterium: $('#runtime-time-criterium-select').val(),
            });
    });

    $('#runtime-report-clear-btn').on('click', () => {
        clearRuntimeReport();
    });

    $('#runtime-report-browse-btn').on('click', () => {
        $('#runtime-report-file-input').trigger('click');
    });

    if (vscode)
        vscode.postMessage({
            type: 'sdfv.refresh_analysis_pane',
        });
});
