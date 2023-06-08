// Copyright 2020-2023 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import {
    ExtensionContext,
    OutputChannel,
    Uri,
    commands,
    window,
    workspace
} from 'vscode';
import { AnalysisProvider } from './components/analysis';
import { SDFGEditorBase } from './components/sdfg_editor/common';

export class DaCeVSCode {

    private static INSTANCE = new DaCeVSCode();

    private constructor() { }

    public static getInstance(): DaCeVSCode {
        return this.INSTANCE;
    }

    private context?: ExtensionContext;
    private _outputChannel?: OutputChannel;

    public readonly sdfgEditorMap: Map<Uri, SDFGEditorBase> = new Map();
    private _activeEditor?: SDFGEditorBase;

    public openInstrumentationReport(url: Uri, report: any): void {
        // Show the SDFG Analysis panel if it's hidden.
        const analysisProvider = AnalysisProvider.getInstance();
        if (!analysisProvider)
            return;

        // Make the analysis panel visible.
        if (!analysisProvider.isVisible())
            commands.executeCommand(
                'sdfgAnalysis.focus'
            );

        analysisProvider.invoke(
            'onAutoloadReport', [url.fsPath]
        ).then((criterium: string) => {
            this._activeEditor?.invoke(
                'loadInstrumentationReport', [report, criterium]
            );
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

                const autoOpenPref = autoOpen?.get<string>(configKey);
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
    }

    public getExtensionContext() {
        return this.context;
    }

    public static getExtensionContext() {
        return this.INSTANCE.getExtensionContext();
    }

    public get outputChannel(): OutputChannel {
        if (!this._outputChannel)
            this._outputChannel = window.createOutputChannel(
                'SDFG Viewer'
            );
        return this._outputChannel;
    }

    public async getActiveSdfg(fromDisk = false): Promise<any | undefined> {
        if (!this.activeSDFGEditor)
            return undefined;

        let sdfgJson = undefined;
        /*
        TODO
        if (fromDisk === true)
            sdfgJson = (await workspace.fs.readFile(
                this.activeSDFGEditor.document.uri
            )).toString();
        else
            sdfgJson = this.activeSDFGEditor.document.getText();
            */
        sdfgJson = (await workspace.fs.readFile(
            this.activeSDFGEditor.document.uri
        )).toString();

        if (sdfgJson === '' || !sdfgJson)
            sdfgJson = undefined;
        else
            sdfgJson = JSON.parse(sdfgJson);
        return sdfgJson;
    }

    public get activeSDFGEditor(): SDFGEditorBase | undefined {
        return this._activeEditor;
    }

    public set activeSDFGEditor(editor: SDFGEditorBase | undefined) {
        this._activeEditor = editor;
    }

}
