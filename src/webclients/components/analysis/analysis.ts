// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

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
