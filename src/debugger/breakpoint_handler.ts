// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeVSCode } from '../extension';
import { SdfgViewerProvider } from '../components/sdfg_viewer';
import { SdfgBreakpointProvider } from '../components/sdfg_breakpoints';

export type ISDFGDebugNodeInfo = {
    cache: string | undefined,
    target: string | undefined,
    sdfgName: string | undefined,
    sdfgId: number,
    stateId: number,
    nodeId: number,
    sdfgPath: string | undefined,
};

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
        return this.sdfgId + ':' +
            this.stateId + ':' +
            this.nodeId;
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

interface IHashFiles {
    [key: string]: IFunction[];
}

interface IHashNodes {
    [key: string]: SDFGDebugNode[];
}

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
        super(() => this.disposeFunction());
        this.files = {};
        this.savedNodes = {};
        this.setBreakpoints = [];
        this.showMenu(false);
        this.retrieveState();

        // When a debug session terminates and there isn't any active session
        // remove all C++ breakpoints
        vscode.debug.onDidTerminateDebugSession(res => {
            if (!vscode.debug.activeDebugSession)
                this.removeAllBreakpoints();
        });

        // VScode has a very strange way of registering Breakpoints after
        // first activation. If we don't create an onDidChangeBreakpoints
        // the breakpoints won't be recognized when running the debugger
        // the first time after activation and so the breakpoint won't be map.
        vscode.debug.onDidChangeBreakpoints(_ => { });
    }

    public static getInstance(): BreakpointHandler | undefined {
        return this.INSTANCE;
    }

    public static activate(context: vscode.ExtensionContext) {
        BreakpointHandler.INSTANCE = new BreakpointHandler();

        context.subscriptions.push(
            vscode.commands.registerCommand(
                'sdfg.goto.sdfg',
                (resource: vscode.Uri) => {
                    if (resource) {
                        const BPHinstance = BreakpointHandler.getInstance();

                        if (resource.fsPath.endsWith('.py')) {
                            let files = BPHinstance?.files;
                            let filePath = normalizePath(resource.fsPath);

                            // Check if there is a corresponding SDFG file saved
                            // If thats the case, display the SDFG
                            if (files && filePath &&
                                files[filePath].length !== 0) {
                                // TODO: look through list for the right file as
                                // one src file might have multiple SDFG
                                // programs.
                                const sdfgPath = path.join(
                                    files[filePath][0].cache,
                                    'program.sdfg'
                                );
                                SdfgViewerProvider.getInstance()?.openViewer(
                                    vscode.Uri.file(sdfgPath)
                                );
                            }
                        }
                        else if (resource.fsPath.endsWith('.cpp')) {
                            if (BPHinstance && BPHinstance.currentFunc) {
                                const sdfgPath = path.join(
                                    BPHinstance.currentFunc.cache,
                                    'program.sdfg'
                                );
                                SdfgViewerProvider.getInstance()?.openViewer(
                                    vscode.Uri.file(sdfgPath)
                                );
                            }
                        }
                    }
                }
            ),
            vscode.commands.registerCommand(
                'sdfg.goto.cpp',
                async (resource: vscode.Uri) => {
                    if (resource) {
                        const editor = vscode.window.activeTextEditor;
                        const position = editor?.selection.active;
                        const BPHinstance = BreakpointHandler.getInstance();

                        // Translate the current cursor position to a C++ Line
                        let location;
                        if (position && editor && editor.document)
                            location = await BPHinstance?.pyCppTranslation(
                                editor.document.uri,
                                position.line
                            );

                        // Check if there is a corresponding C++ file saved
                        let files = BPHinstance?.files;
                        let filePath = normalizePath(resource.fsPath);
                        if (files && filePath && files[filePath].length !== 0) {
                            // Jump to the corresponding location in
                            // the C++ file
                            // TODO: look through list for the right file as one 
                            //      src file might have multiple Dace programs
                            let file = files[filePath][0];
                            SdfgViewerProvider.getInstance()?.goToFileLocation(
                                vscode.Uri.file(
                                    path.join(
                                        file.cache,
                                        'src',
                                        file.targetName,
                                        file.name + '.cpp'
                                    )
                                ),
                                location ? location.line : 0, 0,
                                location ? location.line : 0, 0
                            );
                        }

                    }
                }
            ),
            vscode.commands.registerCommand(
                'sdfg.goto.py',
                (resource: vscode.Uri) => {
                    if (resource) {
                        const BPHinstance = BreakpointHandler.getInstance();

                        if (BPHinstance && BPHinstance.currentFunc) {
                            SdfgViewerProvider.getInstance()?.goToFileLocation(
                                BPHinstance.currentFunc.sourceFiles[0],
                                0, 0, 0, 0
                            );
                        }
                    }
                }
            ),
            vscode.commands.registerCommand(
                'sdfg.sourcefiles',
                async (resource: vscode.Uri) => {
                    if (resource) {
                        const BPHinstance = BreakpointHandler.getInstance();

                        if (BPHinstance && BPHinstance.currentFunc) {

                            interface MenuItem extends vscode.QuickPickItem {
                                uri: vscode.Uri;
                            }

                            let items: MenuItem[] = [];
                            const srcFiles =
                                BPHinstance.currentFunc.sourceFiles;
                            for (const src of srcFiles) {
                                items.push({
                                    label: src.path,
                                    uri: src
                                });
                            }

                            const selection: MenuItem | undefined =
                                await vscode.window.showQuickPick(items, {
                                    placeHolder: 'Open sourcefile',
                                });
                            const viewer = SdfgViewerProvider.getInstance();
                            if (selection && viewer)
                                viewer.goToFileLocation(
                                    selection.uri,
                                    0, 0, 0, 0
                                );
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
                if (pathName.endsWith('.git')) {
                    pathName = pathName.slice(0, -4);
                }

                const BPHInstance = BreakpointHandler.getInstance();
                BPHInstance?.showMenu(false);

                if (pathName.endsWith('.py') && BPHInstance) {
                    const files = BPHInstance.files;
                    const currentFile = normalizePath(pathName);
                    // Check if there are corresponding C++ & SDFG files saved
                    // If so, display the Menus
                    if (files && currentFile && files[currentFile] &&
                        files[currentFile].length !== 0) {
                        const file = files[currentFile][0];
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
                        } catch (error) {
                            // Do nothing
                        }
                        return;
                    }
                }
                else if (pathName.endsWith('.cpp') && BPHInstance) {
                    const files = BPHInstance.files;
                    const currentFile = normalizePath(pathName);
                    for (const functions of Object.values(files)) {
                        for (const func of functions) {
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
                async provideHover(document, position, token) {
                    const INSTANCE = BreakpointHandler.getInstance();
                    const files = INSTANCE?.files;
                    const filePath = normalizePath(document.fileName);
                    if (!INSTANCE || !files || !filePath)
                        return undefined;

                    const func = INSTANCE.currentFunc;
                    if (func && func.codegenMap) {
                        const codegenLoc = await INSTANCE.getCodegen(
                            position.line + 1,
                            func
                        );
                        if (codegenLoc && codegenLoc.file, codegenLoc.line) {
                            const uri = vscode.Uri.file(codegenLoc.file);
                            const hoverLink = new vscode.MarkdownString(
                                `[open CODEGEN]` +
                                `(file://${uri.path}#${codegenLoc.line})`
                            );
                            hoverLink.isTrusted = true;
                            const content = {
                                // For nicer highlighting
                                language: 'javascript',
                                value: `${uri.fsPath}:${codegenLoc.line}`
                            };
                            return new vscode.Hover([content, hoverLink]);
                        }
                    }
                    return undefined;
                }
            })
        );

        return BreakpointHandler.INSTANCE;
    }

    public registerFunction(data: any): void {
        const filePaths: string[] | undefined = data['path_file'];
        const cachePath: string | undefined = data['path_cache'];
        const funcName: string | undefined = data['name'];
        const targetName: string | undefined = data['target_name'];
        const madeWithApi: boolean | undefined = data['made_with_api'];
        const codegenMap: boolean | undefined = data['codegen_map'];

        if (!filePaths || !cachePath || !funcName) {
            return;
        }

        vscode.debug.activeDebugSession?.customRequest('pause');

        /**
         * For each path save the name and the folder path
         * of the function in 'files'
         */
        for (const srcFile of filePaths) {
            let normalizedFilePath = normalizePath(srcFile);
            if (!normalizedFilePath) {
                continue; // Illegal Path
            }

            if (!this.files[normalizedFilePath]) {
                this.files[normalizedFilePath] = [];
            }

            let alreadySaved = this.files[normalizedFilePath].find((elem) => {
                return elem.name === funcName;
            });

            if (!alreadySaved) {
                this.files[normalizedFilePath].push(
                    {
                        name: funcName,
                        cache: cachePath,
                        targetName: targetName ? targetName : 'cpu',
                        sourceFiles: filePaths.map(
                            file => vscode.Uri.file(file)
                        ),
                        madeWithApi: madeWithApi ? madeWithApi : false,
                        codegenMap: codegenMap ? codegenMap : false,
                    }
                );
            } else {
                alreadySaved.cache = cachePath;
                alreadySaved.targetName = targetName ? targetName : 'cpu';
                alreadySaved.codegenMap = codegenMap ? codegenMap : false;
                alreadySaved.madeWithApi = madeWithApi ? madeWithApi : false;
                alreadySaved.sourceFiles =
                    filePaths.map(file => vscode.Uri.file(file));
            }
        }
        this.setAllBreakpoints();
        vscode.debug.activeDebugSession?.customRequest('continue');
        this.showMenu(true, [Menus.GOTO_SDFG, Menus.GOTO_CPP]);
        this.saveState();
    }

    public handleMessage(message: any, _origin: any) {
        let node: ISDFGDebugNodeInfo;
        switch (message.type) {
            case 'add_breakpoint':
                node = message.node;
                if (node)
                    BreakpointHandler.getInstance()?.handleNodeAdded(
                        new SDFGDebugNode(
                            node.sdfgId, node.stateId, node.nodeId
                        ),
                        message.sdfgName
                    );
                break;
            case 'remove_breakpoint':
                node = message.node;
                if (node)
                    BreakpointHandler.getInstance()?.handleNodeRemoved(
                        new SDFGDebugNode(
                            node.sdfgId, node.stateId, node.nodeId
                        ),
                        message.sdfgName
                    );
                break;
            case 'get_saved_nodes':
                BreakpointHandler.getInstance()?.getSavedNodes(
                    message.sdfgName
                );
                break;
            case 'has_saved_nodes':
                BreakpointHandler.getInstance()?.hasSavedNodes(
                    message.sdfgName
                );
                break;
            case 'change_diff_threshold':
                DaCeVSCode.getExtensionContext()?.workspaceState
                    .update('diffText', message.diffText);
                DaCeVSCode.getExtensionContext()?.workspaceState
                    .update('diffRange', message.diffRange);
                break;
            default:
                break;
        }
    }

    public setAllBreakpoints(): void {
        // Map and set all Breakpoints set in the dace (python) code
        vscode.debug.breakpoints.filter(pyFilter).forEach(bp => {
            this.handleBreakpointAdded(bp as vscode.SourceBreakpoint);
        });

        // Map and set all Breakpoints set directly on the sdfg
        Object.entries(this.savedNodes).forEach(([sdfgName, nodes]) => {
            nodes.forEach(async node => {
                this.createBpFromNode(node, sdfgName);
            });
        });
    }

    public removeAllBreakpoints(): void {
        this.setBreakpoints.forEach(savedBp => {
            vscode.debug.removeBreakpoints([savedBp.bp]);
        });
        this.setBreakpoints = [];
    }

    private async handleBreakpointAdded(
        breakpoint: vscode.SourceBreakpoint
    ): Promise<void> {
        const location = await this.pyCppTranslation(
            breakpoint.location.uri,
            breakpoint.location.range.start.line
        );

        // We don't map Breakpoints if the SDFG was created with the API due
        // to the BP already hitting in the python script
        if (!location || location.madeWithApi)
            return;

        const newBp = this.createBreakpoint(
            location.line,
            location.cachePath,
            location.functionName,
            location.target
        );

        const funcName = location.functionName;
        const alreadyExists = this.setBreakpoints.find((bp) => {
            return bp.identifier === this.getBreakpointIdentifier(newBp, funcName);
        });

        if (!alreadyExists) {
            this.setBreakpoints.push({
                bp: newBp,
                identifier: this.getBreakpointIdentifier(newBp, funcName)
            });
            vscode.debug.addBreakpoints([newBp]);
        }
    }

    public async pyCppTranslation(
        uri: vscode.Uri, line: number
    ): Promise<any | null> {
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

            if (!nodes || (nodes && nodes.length === 0))
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

            if (!range || !range.from)
                continue;

            return {
                line: range.from,
                cachePath: cachePath,
                functionName: currentFunc.name,
                target: currentFunc.targetName,
                madeWithApi: currentFunc.madeWithApi
            };
        }

        return null;
    }

    private async getNode(
        line: number,
        path: vscode.Uri,
        srcFile: string
    ): Promise<SDFGDebugNode[] | undefined> {

        const mapPy = await jsonFromPath(path);
        if (!mapPy)
            return undefined;

        const srcMap = mapPy[srcFile];

        if (!srcMap)
            return undefined;

        const nodesJSON = srcMap[line.toString()];
        if (!nodesJSON)
            return undefined;

        if (!Array.isArray(nodesJSON)) {
            vscode.window.showInformationMessage(
                'Source Mapping seems to have the wrong format!'
            );
            return undefined;
        }

        try {
            nodesJSON.map(node => {
                new SDFGDebugNode(
                    node.sdfg_id,
                    node.state_id,
                    node.node_id
                );
            });
        } catch (error) {
            vscode.window.showInformationMessage(
                'Source Mapping seems to have the wrong format!'
            );
            return undefined;
        }

        return nodesJSON;
    }

    private async getCodegen(line: Number, func: IFunction) {
        const codegenPath = path.join(func.cache, 'map', 'map_codegen.json');
        const filePath = vscode.Uri.file(codegenPath);
        const genMap = await jsonFromPath(filePath);
        return genMap[line.toString()];
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

    private getBreakpointIdentifier(
        breakpoint: vscode.SourceBreakpoint,
        sdfgName: string
    ): string {
        // Create an identifier for a Breakpoint location in a C++ file
        let range = breakpoint.location.range;
        return sdfgName + '/' +
            range.start.line + '/' +
            range.start.character + '/' +
            range.end.line + '/' +
            range.end.character + '/';
    }

    public async handleNodeAdded(
        node: SDFGDebugNode, sdfgName: string
    ): Promise<void> {
        // Search for the file with the corresponding function information.
        let unbound = false;
        for (const functions of Object.values(this.files)) {
            const funcDetails = functions.find(func => {
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

                if (!range || !range.from) {
                    unbound = true;
                    continue;
                }

                // If an active debug session is running, map the breakpoint
                const session = vscode.debug.activeDebugSession;
                if (session && session.configuration.env?.DACE_port)
                    this.createBpFromNode(node, sdfgName);

                if (!this.savedNodes[sdfgName])
                    this.savedNodes[sdfgName] = [];
                this.savedNodes[sdfgName].push(node);
                SdfgBreakpointProvider.getInstance()?.handleMessage({
                    'type': 'add_sdfg_breakpoint',
                    'node': node.nodeInfo()
                });
                return;
            }
        }

        if (unbound) {
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                'type': 'unbound_breakpoint',
                'node': node.nodeInfo()
            });
            SdfgBreakpointProvider.getInstance()?.handleMessage({
                'type': 'unbound_sdfg_breakpoint',
                'node': node.nodeInfo()
            });
        }

        this.saveState();
    }

    public handleNodeRemoved(node: SDFGDebugNode, sdfgName: string): void {
        if (this.savedNodes[sdfgName]) {
            this.savedNodes[sdfgName].forEach((n, i, _) => {
                if (node.isEqual(n)) {
                    this.savedNodes[sdfgName].splice(i, 1);
                    return;
                }
            });
            this.saveState();
            SdfgBreakpointProvider.getInstance()?.handleMessage({
                'type': 'refresh_sdfg_breakpoints'
            });
        }
    }

    public async createBpFromNode(
        node: SDFGDebugNode, sdfgName: string
    ): Promise<void> {
        if (!node.cache)
            return;

        const cppMapPath = path.join(node.cache, 'map', 'map_cpp.json');
        const range = await getCppRange(
            node,
            vscode.Uri.file(cppMapPath)
        );

        if (!range || !range.from)
            return;

        const newBp = this.createBreakpoint(
            range.from,
            (node.cache) ? node.cache : '',
            sdfgName,
            node.target
        );

        const newIdentifier = this.getBreakpointIdentifier(newBp, sdfgName);
        const alreadyExists = this.setBreakpoints.find((bp) => {
            return bp.identifier === newIdentifier;
        });

        if (!alreadyExists) {
            vscode.debug.addBreakpoints([newBp]);
            this.setBreakpoints.push({
                bp: newBp,
                identifier: newIdentifier
            });
        }
    }

    public getSavedNodes(sdfgName: string): void {
        // Sends the corresponding saved Nodes to the SDFG viewer
        const nodes = this.savedNodes[sdfgName];
        if (nodes !== undefined && nodes.length !== 0)
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                type: 'saved_nodes',
                nodes: nodes
            });
    }

    public getAllNodes(): ISDFGDebugNodeInfo[] {
        const allNodes = [];
        for (const nodes of Object.values(this.savedNodes)) {
            for (const node of nodes) {
                if (node.cache)
                    allNodes.push(node.nodeInfo());
            }
        }
        return allNodes;
    }

    public hasSavedNodes(sdfgName: string): void {
        const nodes = this.savedNodes[sdfgName];
        if (nodes !== undefined && nodes.length !== 0)
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                type: 'has_nodes'
            });
    }

    public showMenu(
        show: boolean, menus: Menus[] | undefined = undefined
    ): void {
        // If menus is undefined, do same for all
        if (!menus)
            menus = Object.values(Menus);

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

    private async saveState(): Promise<void> {
        DaCeVSCode.getExtensionContext()?.workspaceState.update(
            'files', this.files
        );
        DaCeVSCode.getExtensionContext()?.workspaceState.update(
            'savedNodes', this.savedNodes
        );
    }

    private async retrieveState(): Promise<void> {
        const context = DaCeVSCode.getExtensionContext();
        if (!context)
            return;
        this.savedNodes = context.workspaceState.get('savedNodes', {});
        this.files = context.workspaceState.get('files', {});
    }

    public disposeFunction(): void {
        this.removeAllBreakpoints();
        //this.saveState();
    }

}

export async function getCppRange(
    node: SDFGDebugNode, uri: vscode.Uri
): Promise<{ from: number, to: number } | null> {
    let mapCpp = await jsonFromPath(uri);
    if (!mapCpp)
        return null;

    let states = mapCpp[node.sdfgId];
    if (!states)
        return null;

    // Return the Range of an entire SDFG
    if (node.stateId === -1) {
        let minLine = Number.MAX_VALUE;
        let maxLine = 0;
        // It's guaranteed that we will find at least one node
        Object.values(states).forEach((state: any) => {
            Object.values(state).forEach((node: any) => {
                if (node.from < minLine)
                    minLine = node.from;
                if (node.to > maxLine)
                    maxLine = node.to;
            });
        });
        return {
            from: minLine,
            to: maxLine
        };
    }

    let nodes = states[node.stateId];
    if (!nodes)
        return null;

    // Return the Range of an entire State
    if (node.nodeId === -1) {
        let minLine = Number.MAX_VALUE;
        let maxLine = 0;
        // It's guaranteed that we will find at least one node
        Object.values(nodes).forEach((node: any) => {
            if (node.from < minLine)
                minLine = node.from;
            if (node.to > maxLine)
                maxLine = node.to;
        });

        return {
            from: minLine,
            to: maxLine
        };
    }

    // Return the Range of a single node if it exists
    let cppRange = nodes[node.nodeId];
    if (!cppRange)
        return null;
    return cppRange;
}

async function jsonFromPath(fileUri: vscode.Uri): Promise<any | null> {
    /**
     * Reads the file from the given path and parses it to JSON.
     * Returns null if there is an error while reading the file or if the file
     * doesn't exist.
     */

    try {
        await vscode.workspace.fs.stat(fileUri);
    } catch (error) {
        // If the file doesn't exist, the program might not have been compiled
        // yet, so we don't throw an error.
        return null;
    }

    try {
        return vscode.workspace.fs.readFile(fileUri).then(data => {
            return JSON.parse(Buffer.from(data).toString());
        });
    } catch (error) {
        let msg =
            'Error while opening source mapping at: ' + fileUri.fsPath +
            'Error code: ' + (error as any).code;
        vscode.window.showInformationMessage(msg);
        return null;
    }
}

function pyFilter(bp: vscode.Breakpoint): boolean {
    if (!(bp instanceof vscode.SourceBreakpoint))
        return false;
    const sourceBP = bp as vscode.SourceBreakpoint;
    return sourceBP.location.uri.fsPath.endsWith('.py');
}

function normalizePath(path: string): string | undefined {
    let parsedPath;
    try {
        parsedPath = vscode.Uri.parse(path);
    } catch (error) {
        return undefined;
    }
    const splitPath = parsedPath.fsPath.split(":");
    return splitPath[splitPath.length - 1];
}
