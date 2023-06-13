// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { ExtensionContext, window, workspace } from 'vscode';
import { registerCommands } from './commands';
import { AnalysisProvider } from './components/analysis';
import { DaCeInterface } from './components/dace_interface';
import { OutlineProvider } from './components/outline';
import { SdfgBreakpointProvider } from './components/sdfg_breakpoints';
import {
    CompressedSDFGEditorProvider,
} from './components/sdfg_editor/compressed_sdfg_editor';
import { SDFGEditorProvider } from './components/sdfg_editor/sdfg_editor';
import {
    TransformationHistoryProvider,
} from './components/transformation_history';
import { TransformationListProvider } from './components/transformation_list';
import { DaCeVSCode } from './dace_vscode';
import { activateDaceDebug } from './debugger/dace_debugger';
import { activateSdfgPython } from './debugger/sdfg_python_debugger';

/**
 * Activates the plugin.
 * @param ctx The extension context to load into.
 */
export function activate(ctx: ExtensionContext): void {
    DaCeVSCode.getInstance().init(ctx);

    // Register the SDFG custom editor.
    ctx.subscriptions.push(SDFGEditorProvider.getInstance().register(ctx));
    ctx.subscriptions.push(
        CompressedSDFGEditorProvider.getInstance().register(ctx)
    );

    // Register all webview view components.
    ctx.subscriptions.push(TransformationListProvider.register(ctx));
    ctx.subscriptions.push(TransformationHistoryProvider.register(ctx));
    ctx.subscriptions.push(OutlineProvider.register(ctx));
    ctx.subscriptions.push(AnalysisProvider.register(ctx));
    ctx.subscriptions.push(SdfgBreakpointProvider.register(ctx));
    ctx.subscriptions.push(DaCeInterface.register(ctx));

    const sdfgWatcher = workspace.createFileSystemWatcher(
        '**/.dacecache/**/program.sdfgl'
    );
    sdfgWatcher.onDidCreate((url) => {
        workspace.fs.readFile(url).then((data) => {
            DaCeVSCode.getInstance().parseSdfgLinkFile(
                data.toString(), url.fsPath
            );
        });
    });
    sdfgWatcher.onDidChange((url) => {
        workspace.fs.readFile(url).then((data) => {
            DaCeVSCode.getInstance().parseSdfgLinkFile(
                data.toString(), url.fsPath
            );
        });
    });
    ctx.subscriptions.push(sdfgWatcher);

    const perfReportWatcher = workspace.createFileSystemWatcher(
        '**/.dacecache/**/perf/*.json'
    );
    perfReportWatcher.onDidCreate((url) => {
        workspace.fs.readFile(url).then((data) => {
            const report = JSON.parse(data.toString());

            const autoOpen =
                workspace.getConfiguration('dace.general');
            const configKey = 'autoOpenInstrumentationReports';

            const autoOpenPref = autoOpen?.get<string>(configKey);
            if (autoOpenPref === 'Always') {
                DaCeVSCode.getInstance().openInstrumentationReport(url, report);
                return;
            } else if (autoOpenPref === 'Never') {
                return;
            } else {
                window.showInformationMessage(
                    'A report file was just generated, do you want to ' +
                        'load it?',
                    'Always',
                    'Yes',
                    'No',
                    'Never'
                ).then((opt) => {
                    switch (opt) {
                        case 'Always':
                            autoOpen.update(configKey, 'Always');
                        // Fall through.
                        case 'Yes':
                            DaCeVSCode.getInstance().openInstrumentationReport(
                                url, report
                            );
                            break;
                        case 'Never':
                            autoOpen.update(configKey, 'Never');
                        // Fall through.
                        case 'No':
                            break;
                    }
                });
            }
        });
    });
    ctx.subscriptions.push(perfReportWatcher);

    registerCommands(ctx);
    activateSdfgPython(ctx);
    activateDaceDebug(ctx);
}

/**
 * Called when the extension gets deactivated, ie. when VSCode is shut down.
 */
export function deactivate(): void {
    let context = DaCeVSCode.getInstance().getExtensionContext();
    if (context)
        context.subscriptions.forEach(item => item.dispose());
}
