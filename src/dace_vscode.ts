// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    EventEmitter,
    ExtensionContext,
    OutputChannel,
    Uri,
    commands,
    window,
    workspace,
} from 'vscode';
import { gunzipSync } from 'zlib';
import { AnalysisProvider } from './components/analysis';
import { SDFGEditorBase } from './components/sdfg_editor/common';
import { CompressedSDFGDocument } from './components/sdfg_editor/sdfg_document';
import { OptimizationPanel } from './components/optimization_panel';
import { JsonSDFG } from '@spcl/sdfv/src';

interface ChangeActiveSDFGEditorEvent {
    readonly activeEditor?: SDFGEditorBase;
}

export class DaCeVSCode {

    private static INSTANCE = new DaCeVSCode();

    private constructor() {
        return;
    }

    public static getInstance(): DaCeVSCode {
        return this.INSTANCE;
    }

    private readonly _onDidChangeActiveSDFGEditor =
        new EventEmitter<ChangeActiveSDFGEditorEvent>();
    public readonly onDidChangeActiveSDFGEditor =
        this._onDidChangeActiveSDFGEditor.event;

    private context?: ExtensionContext;
    private _outputChannel?: OutputChannel;

    public readonly sdfgEditorMap = new Map<Uri, SDFGEditorBase>();
    private _activeEditor?: SDFGEditorBase;

    public openInstrumentationReport(url: Uri, report: any): void {
        // Show the SDFG Analysis panel if it's hidden.
        const analysisProvider = AnalysisProvider.getInstance();
        if (!analysisProvider)
            return;

        // Make the analysis panel visible.
        if (!analysisProvider.isVisible())
            commands.executeCommand('sdfgAnalysis.focus');

        analysisProvider.invoke<string>(
            'onAutoloadReport', [url.fsPath]
        ).then(async (criterium) => {
            await this._activeEditor?.invoke(
                'loadInstrumentationReport', [report, criterium]
            );
        }).catch((err: unknown) => {
            console.error('Error loading instrumentation report:', err);
        });
    }

    private openGeneratedSdfg(
        sdfgUri: Uri, sourcePath: string, linkFile?: string, argv?: string[]
    ): void {
        commands.executeCommand('vscode.open', sdfgUri).then(() => {
            const editor = this.sdfgEditorMap.get(sdfgUri);
            if (editor) {
                editor.wrapperFile = sourcePath;
                editor.linkFile = linkFile;
                editor.argv = argv;
            }
        });
    }

    public async parseSdfgLinkFile(
        raw: string, path: string
    ): Promise<boolean> {
        const lines = raw.split(/\r?\n/);
        if (lines.length < 2)
            return false;

        // Check that the header defines the correct columns exepcted in this
        // file.
        const header = lines[0];
        const cols = header.split(',');
        if (cols.length < 4)
            return false;

        if (cols[0] !== 'name' || cols[1] !== 'SDFG_intermediate' ||
            cols[2] !== 'SDFG' || cols[3] !== 'source')
            return false;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];

            const elements = line.split(',');

            if (elements.length !== cols.length)
                return false;

            if (elements.length >= 4) {
                const name = elements[0];
                const intermediateSdfgPath = elements[1];
                const intermediateSdfgUri = Uri.file(intermediateSdfgPath);
                const sdfgPath = elements[2];
                const sdfgUri = Uri.file(sdfgPath);
                const sourcePath = elements[3];
                const argv = elements.slice(4, elements.length - 1);

                // Check if the SDFG file actually exists. If not, check if the
                // _dacegraphs SDFG exists as a fallback.
                let targetUri = intermediateSdfgUri;
                try {
                    await workspace.fs.stat(targetUri);
                } catch {
                    targetUri = sdfgUri;
                    try {
                        await workspace.fs.stat(targetUri);
                    } catch {
                        // The _dacegraphs SDFG also doesn't exist, move on.
                        continue;
                    }
                }

                // Check if the SDFG isn't currently open. If it is, don't
                // do anything.
                if (this.activeSDFGEditor !== undefined &&
                    targetUri.fsPath ===
                    this.activeSDFGEditor.document.uri.fsPath)
                    continue;

                const autoOpen =
                    workspace.getConfiguration('dace.general');
                const configKey = 'autoOpenSdfgs';

                const autoOpenPref = autoOpen.get<string>(configKey);
                if (autoOpenPref === 'Always') {
                    this.openGeneratedSdfg(
                        targetUri,
                        sourcePath,
                        path,
                        argv
                    );
                    continue;
                } else if (autoOpenPref === 'Never') {
                    continue;
                } else {
                    window.showInformationMessage(
                        'An SDFG with the name ' + name +
                        ' was generated, do you want to show it?',
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
                                this.openGeneratedSdfg(
                                    targetUri,
                                    sourcePath,
                                    path,
                                    argv
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
            }
        }
        return true;
    }

    public init(ctx: ExtensionContext): void {
        this.context = ctx;

        this.onDidChangeActiveSDFGEditor(async (e) => {
            if (e.activeEditor) {
                await Promise.all([
                    e.activeEditor.invoke('resyncTransformations', [false]),
                    e.activeEditor.invoke('resyncTransformationHistory'),
                    e.activeEditor.invoke('refreshAnalysisPane'),
                    e.activeEditor.invoke('outline'),
                ]);
            } else {
                await OptimizationPanel.getInstance().clearAll();
            }
        });
    }

    public getExtensionContext() {
        return this.context;
    }

    public static getExtensionContext() {
        return this.INSTANCE.getExtensionContext();
    }

    public get outputChannel(): OutputChannel {
        this._outputChannel ??= window.createOutputChannel('SDFG Viewer');
        return this._outputChannel;
    }

    public async getActiveSdfg(
        fromDisk: boolean = false
    ): Promise<JsonSDFG | undefined> {
        if (!this.activeSDFGEditor)
            return undefined;

        let sdfgJson = undefined;
        const document = this.activeSDFGEditor.document;
        if (fromDisk) {
            if (document instanceof CompressedSDFGDocument) {
                sdfgJson = String(gunzipSync(Buffer.from(
                    await workspace.fs.readFile(document.uri)
                )));
            } else {
                sdfgJson = String(await workspace.fs.readFile(document.uri));
            }
        } else {
            if (document instanceof CompressedSDFGDocument) {
                sdfgJson = String(gunzipSync(Buffer.from(
                    document.documentData
                )));
            } else {
                sdfgJson = document.getText();
            }
        }

        if (sdfgJson === '' || !sdfgJson)
            sdfgJson = undefined;
        else
            sdfgJson = JSON.parse(sdfgJson) as JsonSDFG;
        return sdfgJson;
    }

    private _debounceActiveSDFGEditorChangeTimeoutId?: NodeJS.Timeout | number;

    public get activeSDFGEditor(): SDFGEditorBase | undefined {
        return this._activeEditor;
    }

    public set activeSDFGEditor(editor: SDFGEditorBase | undefined) {
        this._activeEditor = editor;
        clearTimeout(this._debounceActiveSDFGEditorChangeTimeoutId);
        this._debounceActiveSDFGEditorChangeTimeoutId = setTimeout(
            () => {
                this._onDidChangeActiveSDFGEditor.fire({
                    activeEditor: editor,
                });
            }, 100
        );
    }

}
