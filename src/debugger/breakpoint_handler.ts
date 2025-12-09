// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { SdfgBreakpointProvider } from '../components/sdfg_breakpoints';
import { SDFGEditorBase } from '../components/sdfg_editor/common';
import { DaCeVSCode } from '../dace_vscode';
import { goToFileLocation } from '../utils/utils';

export interface ISDFGDebugNodeInfo {
    cache: string | undefined;
    target: string | undefined;
    sdfgName: string | undefined;
    sdfgId: number;
    stateId: number;
    nodeId: number;
    sdfgPath: string | undefined;
}

export class SDFGDebugNode {

    public cache: string | undefined;
    public target: string | undefined;
    public sdfgName: string | undefined;

    constructor(
        public sdfgId: number,
        public stateId: number,
        public nodeId: number
    ) {
    }

    public printer(): string {
        return this.sdfgId.toString() + ':' +
            this.stateId.toString() + ':' +
            this.nodeId.toString();
    }

    public toString(): string {
        return this.printer();
    }

    public isEqual(node: SDFGDebugNode): boolean {
        return this.sdfgId === node.sdfgId &&
            this.stateId === node.stateId &&
            this.nodeId === node.nodeId;
    }

    public nodeInfo(): ISDFGDebugNodeInfo {
        return {
            sdfgId: this.sdfgId,
            stateId: this.stateId,
            nodeId: this.nodeId,
            sdfgName: this.sdfgName,
            cache: this.cache,
            target: this.target,
            sdfgPath: this.cache ?
                path.join(this.cache, 'program.sdfg') : undefined,
        };
    }

}

interface ISavedBP {
    bp: vscode.SourceBreakpoint,
    identifier: string
}

interface IFunction {
    name: string,
    cache: string,
    targetName: string,
    sourceFiles: vscode.Uri[],
    madeWithApi: boolean,
    codegenMap: boolean
}

type IHashFiles = Partial<Record<string, IFunction[]>>;
type IHashNodes = Partial<Record<string, SDFGDebugNode[]>>;

enum Menus {
    GOTO_SDFG = 'goto_sdfg',
    GOTO_PYTHON = 'goto_python',
    GOTO_CPP = 'goto_cpp'
}

export class BreakpointHandler extends vscode.Disposable {

    private static INSTANCE: BreakpointHandler | undefined = undefined;

    // file path -> array of IFunction (name, cache, target_name)
    files: IHashFiles;

    // Save nodes
    savedNodes: IHashNodes;

    // Save all Breakpoints set in the C++ code for later removal
    setBreakpoints: ISavedBP[];

    // Current cpp file func. Saving to not recompute.
    // Only updated when opening C++ file
    currentFunc: IFunction | undefined = undefined;

    constructor() {
        super(() => {
            this.disposeFunction();
        });
        this.files = {};
        this.savedNodes = {};
        this.setBreakpoints = [];
        this.showMenu(false);
        this.retrieveState();

        // When a debug session terminates and there isn't any active session
        // remove all C++ breakpoints
        vscode.debug.onDidTerminateDebugSession(() => {
            if (!vscode.debug.activeDebugSession)
                this.removeAllBreakpoints();
        });

        // VScode has a very strange way of registering Breakpoints after
        // first activation. If we don't create an onDidChangeBreakpoints
        // the breakpoints won't be recognized when running the debugger
        // the first time after activation and so the breakpoint won't be map.
        vscode.debug.onDidChangeBreakpoints(_ => {
            return;
        });
    }

    public static getInstance(): BreakpointHandler | undefined {
        return this.INSTANCE;
    }

    public static activate(context: vscode.ExtensionContext) {
        BreakpointHandler.INSTANCE = new BreakpointHandler();

        context.subscriptions.push(
            vscode.commands.registerCommand(
                'sdfg.goto.sdfg',
                async (resource?: vscode.Uri) => {
                    if (resource) {
                        const BPHinstance = BreakpointHandler.getInstance();

                        if (resource.fsPath.endsWith('.py')) {
                            const files = BPHinstance?.files;
                            const filePath = normalizePath(resource.fsPath);

                            // Check if there is a corresponding SDFG file saved
                            // If thats the case, display the SDFG
                            if (files && filePath &&
                                files[filePath]?.length !== 0) {
                                // TODO: look through list for the right file as
                                // one src file might have multiple SDFG
                                // programs.
                                const sdfgPath = path.join(
                                    files[filePath]![0].cache,
                                    'program.sdfg'
                                );
                                await SDFGEditorBase.openEditorFor(
                                    vscode.Uri.file(sdfgPath)
                                );
                            }
                        } else if (resource.fsPath.endsWith('.cpp')) {
                            if (BPHinstance?.currentFunc) {
                                const sdfgPath = path.join(
                                    BPHinstance.currentFunc.cache,
                                    'program.sdfg'
                                );
                                await SDFGEditorBase.openEditorFor(
                                    vscode.Uri.file(sdfgPath)
                                );
                            }
                        }
                    }
                }
            ),
            vscode.commands.registerCommand(
                'sdfg.goto.cpp',
                async (resource?: vscode.Uri) => {
                    if (resource) {
                        const editor = vscode.window.activeTextEditor;
                        const position = editor?.selection.active;
                        const BPHinstance = BreakpointHandler.getInstance();

                        // Translate the current cursor position to a C++ Line
                        let location;
                        if (position) {
                            location = await BPHinstance?.pyCppTranslation(
                                editor.document.uri,
                                position.line
                            );
                        }

                        // Check if there is a corresponding C++ file saved
                        const files = BPHinstance?.files;
                        const filePath = normalizePath(resource.fsPath);
                        if (files && filePath &&
                            files[filePath]?.length !== 0) {
                            // Jump to the corresponding location in
                            // the C++ file
                            // TODO: look through list for the right file as one
                            //      src file might have multiple Dace programs
                            const file = files[filePath]![0];
                            goToFileLocation(
                                vscode.Uri.file(
                                    path.join(
                                        file.cache,
                                        'src',
                                        file.targetName,
                                        file.name + '.cpp'
                                    )
                                ),
                                location ? location.line as number : 0, 0,
                                location ? location.line as number : 0, 0
                            );
                        }
                    }
                }
            ),
            vscode.commands.registerCommand(
                'sdfg.goto.py',
                (resource?: vscode.Uri) => {
                    if (resource) {
                        const BPHinstance = BreakpointHandler.getInstance();

                        if (BPHinstance?.currentFunc) {
                            goToFileLocation(
                                BPHinstance.currentFunc.sourceFiles[0],
                                0, 0, 0, 0
                            );
                        }
                    }
                }
            ),
            vscode.commands.registerCommand(
                'sdfg.sourcefiles',
                async (resource?: vscode.Uri) => {
                    if (resource) {
                        const BPHinstance = BreakpointHandler.getInstance();

                        if (BPHinstance?.currentFunc) {
                            interface MenuItem extends vscode.QuickPickItem {
                                uri: vscode.Uri;
                            }

                            const items: MenuItem[] = [];
                            const srcFiles =
                                BPHinstance.currentFunc.sourceFiles;
                            for (const src of srcFiles) {
                                items.push({
                                    label: src.path,
                                    uri: src,
                                });
                            }

                            const selection: MenuItem | undefined =
                                await vscode.window.showQuickPick(items, {
                                    placeHolder: 'Open sourcefile',
                                });
                            if (selection)
                                goToFileLocation(selection.uri, 0, 0, 0, 0);
                        }
                    }
                }
            ),
            vscode.commands.registerCommand(
                'dace.debug.clearState',
                (_resource: vscode.Uri) => {
                    const BPHInstance = BreakpointHandler.getInstance();
                    if (BPHInstance) {
                        BPHInstance.files = {};
                        BPHInstance.savedNodes = {};
                        DaCeVSCode.getExtensionContext()?.workspaceState
                            .update('files', {});
                        DaCeVSCode.getExtensionContext()?.workspaceState
                            .update('savedNodes', {});
                    }
                }
            ),
            vscode.workspace.onDidOpenTextDocument(async res => {
                /*
                   When the User changes the file displayed,
                   check if there is a corresponding SDFG and
                   C++ file saved, if so, display the menus
                   for jumping to the files
                 */

                let pathName = res.fileName;
                // if the pathName ends in "_.py.git", remove ".git"
                if (pathName.endsWith('.git'))
                    pathName = pathName.slice(0, -4);

                const BPHInstance = BreakpointHandler.getInstance();
                BPHInstance?.showMenu(false);

                if (pathName.endsWith('.py') && BPHInstance) {
                    const files = BPHInstance.files;
                    const currentFile = normalizePath(pathName);
                    // Check if there are corresponding C++ & SDFG files saved
                    // If so, display the Menus
                    if (currentFile && files[currentFile]?.length !== 0) {
                        const file = files[currentFile]![0];
                        const filepath = path.join(
                            file.cache,
                            'src',
                            file.targetName,
                            file.name + '.cpp'
                        );

                        try {
                            await vscode.workspace.fs.stat(
                                vscode.Uri.file(filepath)
                            );
                            BPHInstance.showMenu(
                                true, [Menus.GOTO_SDFG, Menus.GOTO_CPP]
                            );
                        } catch (_error) {
                            // Do nothing
                        }
                        return;
                    }
                }
                else if (pathName.endsWith('.cpp') && BPHInstance) {
                    const files = BPHInstance.files;
                    const currentFile = normalizePath(pathName);
                    for (const functions of Object.values(files)) {
                        for (const func of functions ?? []) {
                            const matchFile = path.join(
                                func.cache,
                                'src',
                                func.targetName,
                                func.name + '.cpp'
                            );
                            if (normalizePath(matchFile) === currentFile) {
                                BPHInstance.currentFunc = func;
                                BPHInstance.showMenu(
                                    true, [Menus.GOTO_SDFG, Menus.GOTO_PYTHON]
                                );
                                return;
                            }
                        }
                    }
                }
            }),
            vscode.languages.registerHoverProvider('cpp', {
                async provideHover(document, position, _token) {
                    const INSTANCE = BreakpointHandler.getInstance();
                    const files = INSTANCE?.files;
                    const filePath = normalizePath(document.fileName);
                    if (!INSTANCE || !files || !filePath)
                        return undefined;

                    const func = INSTANCE.currentFunc;
                    if (func?.codegenMap) {
                        const codegenLoc = await INSTANCE.getCodegen(
                            position.line + 1,
                            func
                        );
                        if (codegenLoc?.file) {
                            const uri = vscode.Uri.file(codegenLoc.file);
                            const hoverLink = new vscode.MarkdownString(
                                '[open CODEGEN]' +
                                `(file://${uri.path}#` +
                                `${codegenLoc.line.toString()})`
                            );
                            hoverLink.isTrusted = true;
                            const content = {
                                // For nicer highlighting
                                language: 'javascript',
                                value: `${uri.fsPath}:` +
                                    codegenLoc.line.toString(),
                            };
                            return new vscode.Hover([content, hoverLink]);
                        }
                    }
                    return undefined;
                },
            })
        );

        return BreakpointHandler.INSTANCE;
    }

    public registerFunction(data: Record<string, unknown>): void {
        const filePaths = data.path_file as string[] | undefined;
        const cachePath = data.path_cache as string | undefined;
        const funcName = data.name as string | undefined;
        const targetName = data.target_name as string | undefined;
        const madeWithApi = data.made_with_api as boolean | undefined;
        const codegenMap = data.codegen_map as boolean | undefined;

        if (!filePaths || !cachePath || !funcName)
            return;

        vscode.debug.activeDebugSession?.customRequest('pause');

        /**
         * For each path save the name and the folder path
         * of the function in 'files'
         */
        for (const srcFile of filePaths) {
            const normalizedFilePath = normalizePath(srcFile);
            if (!normalizedFilePath)
                continue; // Illegal Path

            this.files[normalizedFilePath] ??= [];

            const alreadySaved = this.files[normalizedFilePath].find((elem) => {
                return elem.name === funcName;
            });

            if (!alreadySaved) {
                this.files[normalizedFilePath].push(
                    {
                        name: funcName,
                        cache: cachePath,
                        targetName: targetName ?? 'cpu',
                        sourceFiles: filePaths.map(
                            file => vscode.Uri.file(file)
                        ),
                        madeWithApi: madeWithApi ?? false,
                        codegenMap: codegenMap ?? false,
                    }
                );
            } else {
                alreadySaved.cache = cachePath;
                alreadySaved.targetName = targetName ?? 'cpu';
                alreadySaved.codegenMap = codegenMap ?? false;
                alreadySaved.madeWithApi = madeWithApi ?? false;
                alreadySaved.sourceFiles =
                    filePaths.map(file => vscode.Uri.file(file));
            }
        }
        this.setAllBreakpoints();
        vscode.debug.activeDebugSession?.customRequest('continue');
        this.showMenu(true, [Menus.GOTO_SDFG, Menus.GOTO_CPP]);
        this.saveState();
    }

    public setAllBreakpoints() {
        // Map and set all Breakpoints set in the dace (python) code
        vscode.debug.breakpoints.filter(pyFilter).forEach(bp => {
            void this.handleBreakpointAdded(bp as vscode.SourceBreakpoint);
        });

        // Map and set all Breakpoints set directly on the sdfg
        Object.entries(this.savedNodes).forEach(([sdfgName, nodes]) => {
            nodes?.forEach(node => {
                if (!node.cache)
                    return;

                const cppMapPath = path.join(node.cache, 'map', 'map_cpp.json');
                getCppRange(node, vscode.Uri.file(cppMapPath)).then(
                    (range) => {
                        if (!range?.from)
                            return;
                        const newBp = this.createBreakpoint(
                            range.from,
                            (node.cache) ?? '',
                            sdfgName,
                            node.target
                        );

                        const newIdentifier = this.bpIdentifier(
                            newBp, sdfgName
                        );
                        const alreadyExists = this.setBreakpoints.find((bp) => {
                            return bp.identifier === newIdentifier;
                        });

                        if (!alreadyExists) {
                            vscode.debug.addBreakpoints([newBp]);
                            this.setBreakpoints.push({
                                bp: newBp,
                                identifier: newIdentifier,
                            });
                        }
                    }
                ).catch((err: unknown) => {
                    console.error(err);
                    return;
                });
            });
        });
    }

    public removeAllBreakpoints() {
        this.setBreakpoints.forEach(savedBp => {
            vscode.debug.removeBreakpoints([savedBp.bp]);
        });
        this.setBreakpoints = [];
    }

    private async handleBreakpointAdded(bp: vscode.SourceBreakpoint) {
        const location = await this.pyCppTranslation(
            bp.location.uri,
            bp.location.range.start.line
        ) as Record<string, unknown> | undefined;

        // We don't map Breakpoints if the SDFG was created with the API due
        // to the BP already hitting in the python script
        if (!location || location.madeWithApi)
            return;

        const newBp = this.createBreakpoint(
            location.line as number,
            location.cachePath as string,
            location.functionName as string,
            location.target as string
        );

        const funcName = location.functionName as string;
        const alreadyExists = this.setBreakpoints.find((bp) => {
            return bp.identifier === this.bpIdentifier(newBp, funcName);
        });
        if (!alreadyExists) {
            this.setBreakpoints.push({
                bp: newBp,
                identifier: this.bpIdentifier(newBp, funcName),
            });
            vscode.debug.addBreakpoints([newBp]);
        }
    }

    public async pyCppTranslation(
        uri: vscode.Uri, line: number
    ): Promise<Record<string, unknown> | null> {
        // Translate a Python Location to a C++ Location
        const filePath = normalizePath(uri.fsPath);
        if (!filePath)
            return null; // Illegal path

        // If the path hasn't been added yet, then we'll handle the BP
        // later on when the path gets added after compilation of the
        // DaCe program
        // If the path has been added, then we'll receive an array of
        // registered DaCe function names from that path
        const functions = this.files[filePath];
        if (!functions)
            return null;

        for (const currentFunc of functions) {
            const cachePath = currentFunc.cache;
            // Get the corresponding Node, if the line isn't in the map
            // then we expect it's not part of a DaCe program,
            // hence we do nothing and return
            const pyMapPath = path.join(cachePath, 'map', 'map_py.json');
            const nodes = await this.getNode(
                line + 1,
                vscode.Uri.file(pyMapPath),
                uri.fsPath
            );

            if (!nodes || (nodes.length === 0))
                continue;

            let range;
            for (const node of nodes) {
                const cppMapPath = path.join(cachePath, 'map', 'map_cpp.json');
                range = await getCppRange(
                    node,
                    vscode.Uri.file(cppMapPath)
                );
                if (range)
                    break;
            }

            if (!range?.from)
                continue;

            return {
                line: range.from,
                cachePath: cachePath,
                functionName: currentFunc.name,
                target: currentFunc.targetName,
                madeWithApi: currentFunc.madeWithApi,
            };
        }

        return null;
    }

    public async addBreakpoint(
        node: SDFGDebugNode | undefined, sdfgName: string
    ): Promise<void> {
        if (node) {
            return BreakpointHandler.getInstance()?.handleNodeAdded(
                new SDFGDebugNode(node.sdfgId, node.stateId, node.nodeId),
                sdfgName
            );
        }
    }

    public async handleNodeAdded(
        node: SDFGDebugNode, sdfgName: string
    ): Promise<void> {
        // Search for the file with the corresponding function information
        let unbound = false;
        for (const functions of Object.values(this.files)) {
            const funcDetails = functions?.find(func => {
                return func.name === sdfgName;
            });

            if (funcDetails) {
                node.cache = funcDetails.cache;
                node.sdfgName = funcDetails.name;
                node.target = funcDetails.targetName;

                const cppMapPath = path.join(node.cache, 'map', 'map_cpp.json');
                const range = await getCppRange(
                    node,
                    vscode.Uri.file(cppMapPath)
                );

                if (!range?.from) {
                    unbound = true;
                    continue;
                }

                this.savedNodes[sdfgName] ??= [];
                this.savedNodes[sdfgName].push(node);
                await SdfgBreakpointProvider.getInstance()?.addBreakpoint(
                    node.nodeInfo(), false
                );
                return;
            }
        }

        if (unbound) {
            await SdfgBreakpointProvider.getInstance()?.addBreakpoint(
                node.nodeInfo(), true
            );
        }

        this.saveState();
    }

    public async removeBreakpoint(
        node: SDFGDebugNode | undefined, sdfgName: string
    ): Promise<unknown> {
        if (node) {
            return BreakpointHandler.getInstance()?.handleNodeRemoved(
                new SDFGDebugNode(node.sdfgId, node.stateId, node.nodeId),
                sdfgName
            );
        }
        return undefined;
    }

    public async handleNodeRemoved(
        node: SDFGDebugNode, sdfgName: string
    ): Promise<unknown> {
        this.savedNodes[sdfgName]?.forEach((n, i, _) => {
            if (node.isEqual(n)) {
                this.savedNodes[sdfgName]!.splice(i, 1);
                return;
            }
        });
        this.saveState();
        return SdfgBreakpointProvider.getInstance()?.refresh();
    }

    private async getNode(
        line: number,
        path: vscode.Uri,
        srcFile: string
    ): Promise<SDFGDebugNode[] | undefined> {
        const mapPy = await jsonFromPath(path);
        if (!mapPy)
            return undefined;

        const srcMap = mapPy[srcFile] as Record<string, unknown> | undefined;

        if (!srcMap)
            return undefined;

        const nodesJSON = srcMap[line.toString()] as {
            sdfg_id: number,
            state_id: number,
            node_id: number,
        }[] | undefined;
        if (!nodesJSON)
            return undefined;

        if (!Array.isArray(nodesJSON)) {
            vscode.window.showInformationMessage(
                'Source Mapping seems to have the wrong format!'
            );
            return undefined;
        }

        try {
            return nodesJSON.map(node => {
                return new SDFGDebugNode(
                    node.sdfg_id,
                    node.state_id,
                    node.node_id
                );
            });
        } catch (_error) {
            vscode.window.showInformationMessage(
                'Source Mapping seems to have the wrong format!'
            );
            return undefined;
        }
    }

    private async getCodegen(
        line: number, func: IFunction
    ): Promise<{ file: string; line: number } | null | undefined> {
        const codegenPath = path.join(func.cache, 'map', 'map_codegen.json');
        const filePath = vscode.Uri.file(codegenPath);
        const genMap = await jsonFromPath(filePath);
        return genMap![line.toString()] as {
            file: string,
            line: number,
        } | null | undefined;
    }

    private createBreakpoint(
        line: number,
        basePath: string,
        filename: string,
        target: string = 'cpu'
    ): vscode.SourceBreakpoint {
        const cppFile = path.join(
            basePath,
            'src',
            target,
            filename + '.cpp'
        );

        const uri = vscode.Uri.file(cppFile);
        const pos = new vscode.Position(line, 0);
        const location = new vscode.Location(uri, pos);
        return new vscode.SourceBreakpoint(location);
    }

    private bpIdentifier(
        bp: vscode.SourceBreakpoint,
        sdfgName: string
    ): string {
        // Create an identifier for a Breakpoint location in a C++ file
        const range = bp.location.range;
        return sdfgName + '/' +
            range.start.line.toString() + '/' +
            range.start.character.toString() + '/' +
            range.end.line.toString() + '/' +
            range.end.character.toString() + '/';
    }

    public async getSavedNodes(sdfgName: string): Promise<unknown> {
        // Sends the corresponding saved Nodes to the SDFG viewer
        const nodes = this.savedNodes[sdfgName];
        if (nodes?.length !== 0) {
            return DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
                'saved_nodes', [nodes]
            );
        }
        return undefined;
    }

    public getAllNodes(): ISDFGDebugNodeInfo[] {
        const allNodes = [];
        for (const nodes of Object.values(this.savedNodes)) {
            for (const node of nodes ?? []) {
                if (node.cache)
                    allNodes.push(node.nodeInfo());
            }
        }
        return allNodes;
    }

    public async hasSavedNodes(sdfgName: string): Promise<unknown> {
        // TODO: This does not seem to be needed anymore, remove?
        const nodes = this.savedNodes[sdfgName];
        if (nodes?.length !== 0) {
            return DaCeVSCode.getInstance().activeSDFGEditor?.invoke(
                'has_nodes'
            );
        }
        return undefined;
    }

    public showMenu(
        show: boolean, menus: Menus[] | undefined = undefined
    ): void {
        // If menus is undefined, do same for all
        menus ??= Object.values(Menus);

        menus.forEach(menu => {
            switch (menu) {
                case Menus.GOTO_SDFG:
                    vscode.commands.executeCommand(
                        'setContext',
                        'sdfg.showMenu.goto.sdfg',
                        show
                    );
                    break;
                case Menus.GOTO_CPP:
                    vscode.commands.executeCommand(
                        'setContext',
                        'sdfg.showMenu.goto.cpp',
                        show
                    );
                    break;
                case Menus.GOTO_PYTHON:
                    vscode.commands.executeCommand(
                        'setContext',
                        'sdfg.showMenu.goto.py',
                        show
                    );
                    break;
                default:
                    break;
            }
        });
    }

    private saveState(): void {
        DaCeVSCode.getExtensionContext()?.workspaceState.update(
            'files', this.files
        );
        DaCeVSCode.getExtensionContext()?.workspaceState.update(
            'savedNodes', this.savedNodes
        );
    }

    private retrieveState(): void {
        const context = DaCeVSCode.getExtensionContext();
        if (!context)
            return;
        this.savedNodes = context.workspaceState.get('savedNodes', {});
        this.files = context.workspaceState.get('files', {});
    }

    public disposeFunction(): void {
        this.removeAllBreakpoints();
    }

}

export async function getCppRange(
    node: SDFGDebugNode, uri: vscode.Uri
): Promise<{ from: number, to: number } | null> {
    const mapCpp = await jsonFromPath(uri);
    if (!mapCpp)
        return null;

    const states = mapCpp[node.sdfgId] as Partial<
        Record<string, Partial<Record<string, {
            from: number,
            to: number,
        }>>>
    > | undefined;
    if (!states)
        return null;

    // Return the Range of an entire SDFG
    if (node.stateId === -1) {
        let minLine = Number.MAX_VALUE;
        let maxLine = 0;
        // It's guaranteed that we will find at least one node
        Object.values(states).forEach(state => {
            if (!state)
                return;
            Object.values(state).forEach(node => {
                if (!node)
                    return;
                if (node.from < minLine)
                    minLine = node.from;
                if (node.to > maxLine)
                    maxLine = node.to;
            });
        });
        return {
            from: minLine,
            to: maxLine,
        };
    }

    const nodes = states[node.stateId];
    if (!nodes)
        return null;

    // Return the Range of an entire State
    if (node.nodeId === -1) {
        let minLine = Number.MAX_VALUE;
        let maxLine = 0;
        // It's guaranteed that we will find at least one node
        Object.values(nodes).forEach(node => {
            if (!node)
                return;
            if (node.from < minLine)
                minLine = node.from;
            if (node.to > maxLine)
                maxLine = node.to;
        });

        return {
            from: minLine,
            to: maxLine,
        };
    }

    // Return the Range of a single node if it exists
    const cppRange = nodes[node.nodeId];
    if (!cppRange)
        return null;
    return cppRange;
}

async function jsonFromPath(
    fileUri: vscode.Uri
): Promise<Record<string, unknown> | null> {
    /**
     * Reads the file from the given path and parses it to JSON.
     * Returns null if there is an error while reading the file or if the file
     * doesn't exist.
     */

    try {
        await vscode.workspace.fs.stat(fileUri);
    } catch (_e) {
        // If the file doesn't exist, the program might not have been compiled
        // yet, so we don't throw an error.
        return null;
    }

    try {
        const data = await vscode.workspace.fs.readFile(fileUri);
        return JSON.parse(
            Buffer.from(data).toString()
        ) as Record<string, unknown>;
    } catch (error) {
        const msg =
            'Error while opening source mapping at: ' + fileUri.fsPath +
            '\n(' + String(error) + ').';
        vscode.window.showInformationMessage(msg);
        return null;
    }
}

function pyFilter(bp: vscode.Breakpoint): boolean {
    if (!(bp instanceof vscode.SourceBreakpoint))
        return false;
    const sourceBP = bp;
    return sourceBP.location.uri.fsPath.endsWith('.py');
}

function normalizePath(path: string): string | undefined {
    let parsedPath;
    try {
        parsedPath = vscode.Uri.parse(path);
    } catch (_error) {
        return undefined;
    }
    const splitPath = parsedPath.fsPath.split(':');
    return splitPath[splitPath.length - 1];
}
