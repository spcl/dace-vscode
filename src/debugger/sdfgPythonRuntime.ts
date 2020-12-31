import * as vscode from 'vscode';
import * as cp from 'child_process';
import { EventEmitter } from 'events';
import { DaCeVSCode } from '../extension';
import { SdfgViewerProvider } from '../components/sdfgViewer';
import { SdfgPythonLaunchRequestArguments } from './sdfgPythonDebugSession';
import { DaCeInterface } from '../daceInterface';

export class SdfgPythonDebuggerRuntime extends EventEmitter {

    private fileAccessor?: FileAccessor;

    private debug: boolean = false;
    private profile: boolean = false;

    private runningProcesses: cp.ChildProcess[] = [];

    public constructor(fileAccessor: FileAccessor) {
        super();

        this.fileAccessor = fileAccessor;
    }

    public start(args: SdfgPythonLaunchRequestArguments) {
        let program = args.program;

        if (args.profile !== undefined)
            this.profile = args.profile;
        if (args.noDebug !== undefined)
            this.debug = !args.noDebug;

        let webview = undefined;
        if (!program) {
            webview = DaCeVSCode.getInstance().getActiveEditor();
            const fileName = DaCeVSCode.getInstance().getActiveSdfgFileName();

            if (webview === undefined || fileName === undefined) {
                vscode.window.showWarningMessage(
                    'No currently active SDFG to run/profile!'
                );
                this.sendEvent('end');
                return;
            }

            program = fileName;
        }

        const programUri = vscode.Uri.file(program);
        const editor = SdfgViewerProvider.getInstance()?.findEditorForPath(
            programUri
        );

        if (!editor) {
            this.sendEvent(
                'output',
                'No corresponding SDFG editor could be found for the SDFG: ' +
                program,
                'stderr'
            );
            this.sendEvent('end');
            return;
        }

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
                            defaultUri: programUri,
                            filters: {
                                'Python': ['py'],
                                'All Files': ['*'],
                            },
                            openLabel: 'Select and Run',
                            title: 'Select & Run SDFG Source',
                        }).then((uri) => {
                            if (uri) {
                                editor.wrapperFile = uri[0].fsPath;
                                let name = 'Run current SDFG';
                                if (this.profile)
                                    name = 'Profile current SDFG';
                                vscode.debug.startDebugging(undefined, {
                                    type: 'sdfg-python',
                                    name: name,
                                    request: 'launch',
                                    profile: this.profile,
                                    program: program,
                                }, {
                                    noDebug: !this.debug,
                                });
                            }
                        });
                        break;
                    case 'No':
                        break;
                }
            });
            this.sendEvent(
                'output',
                'No source file found for SDFG: ' + program,
                'stderr'
            );
            this.sendEvent('end');
            return;
        }

        this.run(editor.wrapperFile, programUri);
    }

    private async run(path: string, sdfgUri: vscode.Uri) {
        this.sendEvent('output', 'Running wrapper: ' + path, 'console');

        const pythonPath =
            await DaCeInterface.getInstance().getPythonPath(null);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        let workspaceRoot: string | undefined = undefined;
        if (workspaceFolders)
            workspaceRoot = workspaceFolders[0].uri.fsPath;

        const scriptRoot = vscode.Uri.joinPath(vscode.Uri.file(path), '..' );
        if (!workspaceRoot)
            workspaceRoot = scriptRoot.fsPath;

        if (this.debug) {
            vscode.window.showWarningMessage(
                'Debugging SDFGs is not implemented yet, sorry!'
            );
            this.sendEvent('end');
        } else {
            DaCeInterface.getInstance().compileSdfgFromFile(
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
                        DACE_binary_path: data.filename,
                        DACE_profiling: '0',
                    };

                    if (this.profile)
                        env.DACE_profiling = '1';

                    const child = cp.spawn(pythonPath, [path], {
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
                }
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