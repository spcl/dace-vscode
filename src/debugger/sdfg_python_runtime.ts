// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as cp from 'child_process';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { DaCeInterface } from '../components/dace_interface';
import { SDFGEditorBase } from '../components/sdfg_editor/common';
import { SdfgPythonLaunchRequestArguments } from './sdfg_python_debug_session';
import { DaCeVSCode } from '../dace_vscode';

export class SdfgPythonDebuggerRuntime extends EventEmitter {

    private fileAccessor?: FileAccessor;

    private debug: boolean = false;
    private profile: boolean = false;

    private runningProcesses: cp.ChildProcess[] = [];

    public constructor(fileAccessor: FileAccessor) {
        super();

        this.fileAccessor = fileAccessor;
    }

    private startDebugging(uri: vscode.Uri) {
        let name = 'Run current SDFG';
        if (this.profile)
            name = 'Profile current SDFG';
        vscode.debug.startDebugging(undefined, {
            type: 'sdfg-python',
            name: name,
            request: 'launch',
            profile: this.profile,
            program: uri.fsPath,
        }, {
            noDebug: !this.debug,
        });
    }

    private async checkHasWrapper(
        editor: SDFGEditorBase,
        uri: vscode.Uri
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!editor.wrapperFile) {
                vscode.window.showWarningMessage(
                    'No source file is defined for this SDFG. ' +
                    'Do you want to manually pick one?',
                    'Yes',
                    'No'
                ).then((opt) => {
                    switch (opt) {
                        case 'Yes':
                            vscode.window.showOpenDialog({
                                canSelectFiles: true,
                                canSelectFolders: false,
                                canSelectMany: false,
                                defaultUri: uri,
                                filters: {
                                    'Python': ['py'],
                                    'All Files': ['*'],
                                },
                                openLabel: 'Select and Run',
                                title: 'Select & Run SDFG Source',
                            }).then((pUri) => {
                                if (pUri) {
                                    editor.wrapperFile = pUri[0].fsPath;
                                    this.startDebugging(uri);
                                }
                            });
                            break;
                        case 'No':
                            break;
                    }
                });
                this.sendEvent(
                    'output',
                    'No source file found for SDFG: ' + uri.fsPath,
                    'console'
                );
                reject();
            }
            resolve();
        });
    }

    public async start(args: SdfgPythonLaunchRequestArguments) {
        let program = args.program ? vscode.Uri.file(args.program) : undefined;

        if (args.profile !== undefined)
            this.profile = args.profile;
        if (args.noDebug !== undefined)
            this.debug = !args.noDebug;

        if (program === undefined) {
            const editor = DaCeVSCode.getInstance().activeSDFGEditor;
            program = editor?.document?.uri;
        }

        if (!program) {
            vscode.window.showWarningMessage(
                `No currently active SDFG to run/profile`
            );
            this.sendEvent('end');
            return;
        }

        const uri = program;
        const editor = DaCeVSCode.getInstance().sdfgEditorMap.get(uri);

        if (!editor) {
            vscode.commands.executeCommand('vscode.open', uri).then(() => {
                const editor = DaCeVSCode.getInstance().sdfgEditorMap.get(uri);
                if (editor && program) {
                    if (editor.document.isDirty)
                        editor.document.save();
                    this.checkHasWrapper(editor, uri).then(() => {
                        this.run(editor.wrapperFile, uri);
                    });
                } else {
                    this.sendEvent(
                        'output',
                        'No corresponding SDFG editor could be found for ' +
                        'the SDFG: ' + program,
                        'stderr'
                    );
                    this.sendEvent('end');
                }
            });
        } else {
            if (editor.document.isDirty)
                editor.document.save();
            this.checkHasWrapper(editor, uri).then(() => {
                this.run(editor.wrapperFile, uri);
            }, () => {
                this.sendEvent('end');
            });
        }
    }

    private async run(path: string | undefined, sdfgUri: vscode.Uri) {
        if (path === undefined) {
            this.sendEvent('output', 'No path to run provided');
            this.sendEvent('end');
            return;
        }

        this.sendEvent('output', 'Running wrapper: ' + path, 'console');

        const pythonCommand =
            await DaCeInterface.getInstance()?.getPythonExecCommand(
                undefined, false
            );

        if (!pythonCommand) {
            vscode.window.showErrorMessage('Failed to find Python executable');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        let workspaceRoot: string | undefined = undefined;
        if (workspaceFolders)
            workspaceRoot = workspaceFolders[0].uri.fsPath;

        // If no workspace root could be read (e.g. if the user has opened
        // only a file or a directory, but no VS Code workspace), then we try
        // to use the selected run-script's (parent) directory as our workspace
        // root path.
        const scriptRoot = vscode.Uri.joinPath(vscode.Uri.file(path), '..' );
        if (!workspaceRoot)
            workspaceRoot = scriptRoot.fsPath;

        if (this.debug) {
            vscode.window.showWarningMessage(
                'Debugging SDFGs is not implemented'
            );
            this.sendEvent('end');
        } else {
            const suppressInstrumentation = this.profile;
            DaCeInterface.getInstance()?.compileSdfgFromFile(
                sdfgUri,
                (data: any) => {
                    if (data.filename === undefined) {
                        let errorMsg = 'Failed to compile SDFG.';
                        if (data.error)
                            errorMsg += ' Error message: ' +
                                data.error.message + ' (' + data.error.details +
                                ')';
                        vscode.window.showErrorMessage(errorMsg);
                        console.error(errorMsg);
                        this.sendEvent('end');
                        return;
                    }

                    let env = {
                        ...process.env,
                        DACE_compiler_use_cache: '1',
                        DACE_profiling: '0',
                    };

                    if (this.profile)
                        env.DACE_profiling = '1';

                    const child = cp.spawn(pythonCommand, [path], {
                        cwd: workspaceRoot,
                        env: env,
                    });
                    this.runningProcesses.push(child);
                    child.stderr.on('data', (chunk) => {
                        this.sendEvent('output', chunk.toString(), 'stderr');
                    });
                    child.stdout.on('data', (chunk) => {
                        this.sendEvent('output', chunk.toString(), 'stdout');
                    });
                    child.on('error', (err) => {
                        this.sendEvent('output', 'Fatal error!', 'stderr');
                        this.sendEvent('output', err.name, 'stderr');
                        this.sendEvent('output', err.message, 'stderr');
                        this.removeChild(child);
                        this.sendEvent('end');
                    });
                    child.on('exit', (_code, _signal) => {
                        this.removeChild(child);
                        this.sendEvent('end');
                    });
                },
                suppressInstrumentation
            );
        }
    }

    private removeChild(child: cp.ChildProcess) {
        const index: number = this.runningProcesses.indexOf(child, 0);
        if (index > -1)
            this.runningProcesses.splice(index, 1);
    }

    public terminateRunning() {
        this.runningProcesses.forEach((child) => {
            child.kill('SIGKILL');
        });
    }

    private sendEvent(event: string, ...args: any[]) {
        setImmediate(_ => {
            this.emit(event, ...args);
        });
    }

}

export interface FileAccessor {

    readFile(path: string): Promise<string>;

}
