// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

class SymbolResolution {

    constructor() {
        this.symbols = {};
    }

    add_symbol(symbol) {
        if (!(symbol in this.symbols)) {
            this.symbols[symbol] = undefined;
            this.update_symbol_list();
        }
    }

    add_symbols(symbols) {
        Object.keys(symbols).forEach((symbol) => {
            if (!(symbol in this.symbols))
                this.symbols[symbol] = undefined;
        });
        this.update_symbol_list();
    }

    define_symbol(symbol, definition) {
        if (definition !== undefined && !isNaN(definition)) {
            this.symbols[symbol] = definition;
            this.update_symbol_list();
        }
    }

    remove_symbol_definition(symbol) {
        if (symbol in this.symbols) {
            this.symbols[symbol] = undefined;
            this.update_symbol_list();
        }
    }

    remove_symbol(symbol) {
        if (symbol in this.symbols) {
            delete this.symbols[symbol];
            this.update_symbol_list();
        }
    }

    remove_all_symbol_definitions() {
        Object.keys(this.symbols).forEach((symbol) => {
            this.symbols[symbol] = undefined;
        });
        this.update_symbol_list();
    }

    set_symbols(symbols) {
        this.symbols = symbols;
        this.update_symbol_list();
    }

    clear_symbols() {
        this.symbols = {};
        this.update_symbol_list();
    }

    update_symbol_list() {
        if (this.symbol_table === undefined)
            this.symbol_table = $('#symbol-table');

        this.symbol_table.html('');
        Object.keys(this.symbols).forEach((symbol) => {
            const row = $('<tr>', {
                'class': 'symbol-entry',
            }).appendTo(this.symbol_table);
            $('<td>', {
                'class': 'symbol',
                'html': `
                    ${symbol}
                `,
            }).appendTo(row);
            const definition_container = $('<td>', {
                'class': 'symbol-definition',
            }).appendTo(row);
            const input = $('<input>', {
                'class': 'symbol-definition-input',
                'type': 'number',
                'min': '1',
                'placeholder': 'undefined',
            }).appendTo(definition_container);
            if (this.symbols[symbol] !== undefined)
                input.val(this.symbols[symbol]);
            input.change((event) => {
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
            }).appendTo(definition_container);
            let definition = this.symbols[symbol];
            if (definition !== undefined && !isNaN(definition)) {
                definition = +definition;
                if (definition > 0)
                    input.val(definition);
            }
        });
    }

}