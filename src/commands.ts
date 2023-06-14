import { homedir } from 'os';
import { join } from 'path';
import {
    ExtensionContext,
    ProgressLocation,
    Uri,
    commands,
    window,
} from 'vscode';
import { DaCeInterface } from './components/dace_interface';
import { SdfgBreakpointProvider } from './components/sdfg_breakpoints';
import { DaCeVSCode } from './dace_vscode';
import { executeTrusted } from './utils/utils';
import { TransformationListProvider } from './components/transformation_list';
import { TransformationHistoryProvider } from './components/transformation_history';
import { AnalysisProvider } from './components/analysis';
import { OutlineProvider } from './components/outline';


export function registerCommand(
    context: ExtensionContext, command: string, handler: (...args: any[]) => any
): void {
    context?.subscriptions.push(commands.registerCommand(command, handler));
}

export function registerCommands(context: ExtensionContext): void {
    registerCommand(context, 'sdfg.compile', () => {
        const editor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (editor) {
            if (editor.document.isDirty)
                editor.document.save();
            window.withProgress({
                location: ProgressLocation.Window,
                title: 'Compiling SDFG',
                cancellable: false,
            }, (_progress) => {
                return new Promise<string>((resolve, reject) => {
                    DaCeInterface.getInstance()?.compileSdfgFromFile(
                        editor.document.uri, (data: any) => {
                            if (data.filename === undefined) {
                                let errorMsg = 'Failed to compile SDFG.';
                                if (data.error)
                                    errorMsg += ' Error message: ' +
                                        data.error.message + ' (' +
                                        data.error.details + ')';
                                window.showErrorMessage(errorMsg);
                                console.error(errorMsg);
                                reject();
                            } else {
                                resolve(data.filename);
                            }
                        },
                        false
                    );
                });
            }).then((filename) => {
                window.showInformationMessage(
                    'SDFG compiled, library generated at: ' + filename
                );
            });
        }
    });

    registerCommand(context, 'transformationList.addCustom', () => {
        executeTrusted(() => {
            DaCeInterface.getInstance()?.addCustomTransformations(false);
        }, false , 'Loading custom transformations');
    });
    registerCommand(context, 'transformationList.addCustomFromDir', () => {
        executeTrusted(() => {
            DaCeInterface.getInstance()?.addCustomTransformations(true);
        }, false , 'Loading custom transformations');
    });

    registerCommand(context, 'sdfgBreakpoints.sync', () => {
        SdfgBreakpointProvider.getInstance()?.refresh();
    });

    registerCommand(context, 'transformationList.sync', () => {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor)
            activeEditor.invoke('resyncTransformations', [true]);
        else
            TransformationListProvider.getInstance()?.invoke(
                'clearTransformations', ['No SDFG selected']
            );
    });
    registerCommand(context, 'transformationHistory.sync', () => {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor)
            activeEditor.invoke('resyncTransformationHistory');
        else
            TransformationHistoryProvider.getInstance()?.invoke(
                'clearHistory', ['No SDFG selected']
            );
    });
    registerCommand(context, 'sdfgAnalysis.sync', () => {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor)
            activeEditor.invoke('refreshAnalysisPane');
        else
            AnalysisProvider.getInstance()?.invoke(
                'clear', ['No SDFG selected']
            );
    });
    registerCommand(context, 'sdfgOutline.sync', () => {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor)
            activeEditor.invoke('outline');
        else
            OutlineProvider.getInstance()?.invoke(
                'clearOutline', ['No SDFG selected']
            );
    });

    registerCommand(context, 'sdfg.sync', () => {
        DaCeVSCode.getInstance().activeSDFGEditor?.updateContents();
    });

    registerCommand(context, 'sdfg.applyTransformations',
        (t) => DaCeInterface.getInstance()?.applyTransformations(t));
    registerCommand(context, 'sdfg.previewTransformation',
        (t) => DaCeInterface.getInstance()?.previewTransformation(t));
    registerCommand(context, 'sdfg.previewHistoryPoint',
        (h) => DaCeInterface.getInstance()?.previewHistoryPoint(h));
    registerCommand(context, 'sdfg.applyHistoryPoint',
        (h) => DaCeInterface.getInstance()?.applyHistoryPoint(h));
    registerCommand(context, 'dace.installDace', () => {
        executeTrusted(() => {
            const term = window.createTerminal('Install DaCe');
            term.show();
            term.sendText(
                'pip install dace'
            );
        }, false, 'Installing DaCe');
    });

    registerCommand(context, 'dace.config', () => {
        executeTrusted(() => {
            const uri = Uri.file(
                join(homedir(), '.dace.conf')
            );
            commands.executeCommand(
                'vscode.openWith', uri, 'default'
            );
        }, false, 'Accessing the user\'s dace.config');
    });
}

