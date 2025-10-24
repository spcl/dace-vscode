// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { homedir } from 'os';
import { join } from 'path';
import {
    ExtensionContext,
    ProgressLocation,
    Uri,
    commands,
    window,
} from 'vscode';
import { AnalysisProvider } from './components/analysis';
import { DaCeInterface } from './components/dace_interface';
import { OutlineProvider } from './components/outline';
import { SdfgBreakpointProvider } from './components/sdfg_breakpoints';
import {
    TransformationHistoryProvider,
} from './components/transformation_history';
import { TransformationListProvider } from './components/transformation_list';
import { DaCeVSCode } from './dace_vscode';
import { executeTrusted } from './utils/utils';
import {
    JsonTransformation,
} from './webclients/components/transformations/transformations';


export function registerCommand(
    context: ExtensionContext, command: string, handler: (...args: any[]) => any
): void {
    context.subscriptions.push(commands.registerCommand(command, handler));
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
                        editor.document.uri, data => {
                            if (data.filename === undefined) {
                                let errorMsg = 'Failed to compile SDFG.';
                                if (data.error) {
                                    errorMsg += ' Error message: ' +
                                    data.error.message + (
                                        data.error.details ?
                                            ' (' + data.error.details + ')' : ''
                                    );
                                }
                                window.showErrorMessage(errorMsg);
                                console.error(errorMsg);
                                reject(new Error(errorMsg));
                            } else {
                                resolve(data.filename as string);
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
        executeTrusted(async () => {
            await DaCeInterface.getInstance()?.addCustomTransformations(false);
        }, false, 'Loading custom transformations');
    });
    registerCommand(context, 'transformationList.addCustomFromDir', () => {
        executeTrusted(async () => {
            await DaCeInterface.getInstance()?.addCustomTransformations(true);
        }, false, 'Loading custom transformations');
    });

    registerCommand(context, 'sdfgBreakpoints.sync', async () => {
        await SdfgBreakpointProvider.getInstance()?.refresh();
    });

    registerCommand(context, 'transformationList.sync', async () => {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor) {
            await activeEditor.invoke('resyncTransformations', [true]);
        } else {
            await TransformationListProvider.getInstance()?.invoke(
                'clearTransformations', ['No SDFG selected']
            );
        }
    });
    registerCommand(context, 'transformationHistory.sync', async () => {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor) {
            await activeEditor.invoke('resyncTransformationHistory');
        } else {
            await TransformationHistoryProvider.getInstance()?.invoke(
                'clearHistory', ['No SDFG selected']
            );
        }
    });
    registerCommand(context, 'sdfgAnalysis.sync', async () => {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor) {
            await activeEditor.invoke('refreshAnalysisPane');
        } else {
            await AnalysisProvider.getInstance()?.invoke(
                'clear', ['No SDFG selected']
            );
        }
    });
    registerCommand(context, 'sdfgOutline.sync', async () => {
        const activeEditor = DaCeVSCode.getInstance().activeSDFGEditor;
        if (activeEditor) {
            await activeEditor.invoke('outline');
        } else {
            await OutlineProvider.getInstance()?.invoke(
                'clearOutline', ['No SDFG selected']
            );
        }
    });

    registerCommand(context, 'sdfg.sync', async () => {
        await DaCeVSCode.getInstance().activeSDFGEditor?.updateContents();
    });

    registerCommand(
        context, 'sdfg.applyTransformations',
        async (t: JsonTransformation[]) => {
            await DaCeInterface.getInstance()?.applyTransformations(t);
        }
    );
    registerCommand(
        context, 'sdfg.previewTransformation',
        async (t: JsonTransformation) => {
            await DaCeInterface.getInstance()?.previewTransformation(t);
        }
    );
    registerCommand(
        context, 'sdfg.previewHistoryPoint',
        async (h?: number | null) => {
            await DaCeInterface.getInstance()?.previewHistoryPoint(h);
        }
    );
    registerCommand(
        context, 'sdfg.applyHistoryPoint',
        async (h?: number) => {
            await DaCeInterface.getInstance()?.applyHistoryPoint(h);
        }
    );
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

