// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeVSCode } from '../extension';
import { SdfgViewerProvider } from '../components/sdfgViewer';
import { SdfgBreakpointProvider } from '../components/sdfgBreakpoints';

export class Node {
    sdfg_id: number;
    state_id: number;
    node_id: number;

    cache: string | undefined;
    target: string | undefined;
    sdfg_name: string | undefined;

    constructor(sdfg_id: number, state_id: number, node_id: number) {
        this.sdfg_id = sdfg_id;
        this.state_id = state_id;
        this.node_id = node_id;
    }

    public printer(): string {
        return this.sdfg_id + ':' +
            this.state_id + ':' +
            this.node_id;
    }

    public isEqual(node: Node): boolean {
        return this.sdfg_id === node.sdfg_id &&
            this.state_id === node.state_id &&
            this.node_id === node.node_id;
    }

    public nodeInfo() {
        return {
            sdfg_id: this.sdfg_id,
            state_id: this.state_id,
            node_id: this.node_id,

            sdfg_name: this.sdfg_name,
            cache: this.cache,
            target: this.target,

            sdfg_path: this.cache ?
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
    target_name: string,
    source_files: vscode.Uri[],
    made_with_api: boolean,
    codegen_map: boolean
}

interface IHashFiles {
    [key: string]: IFunction[];
}

interface IHashNodes {
    [key: string]: Node[];
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
                            if (files && filePath && files[filePath].length !== 0) {
                                // TODO: look through list for the right file as one 
                                //      src file might have multiple Dace programs
                                const sdfgPath = path.join(
                                    files[filePath][0].cache,
                                    "program.sdfg"
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
                                    "program.sdfg"
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
                                        "src",
                                        file.target_name,
                                        file.name + ".cpp"
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
                                BPHinstance.currentFunc.source_files[0],
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
                            for (const src of BPHinstance.currentFunc.source_files) {
                                items.push({
                                    label: src.path,
                                    uri: src
                                });
                            }

                            const selection:
                                | MenuItem
                                | undefined = await vscode.window.showQuickPick(items, {
                                    placeHolder: "Open sourcefile",
                                });
                            if (selection)
                                SdfgViewerProvider.getInstance()?.goToFileLocation(
                                    selection.uri,
                                    0, 0, 0, 0
                                );
                        }
                    }
                }
            ),
            vscode.commands.registerCommand(
                'dace.debug.clearState',
                (resource: vscode.Uri) => {
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
                if (pathName.endsWith(".git")) {
                    pathName = pathName.slice(0, -4);
                }

                const BPHInstance = BreakpointHandler.getInstance();
                BPHInstance?.showMenu(false);

                if (pathName.endsWith(".py") && BPHInstance) {
                    let files = BPHInstance.files;
                    let currentFile = normalizePath(pathName);
                    // Check if there are corresponding C++ & SDFG files saved
                    // If so, display the Menus
                    if (files && currentFile && files[currentFile] &&
                        files[currentFile].length !== 0) {
                        let file = files[currentFile][0];
                        let filepath = path.join(
                            file.cache,
                            "src",
                            file.target_name,
                            file.name + ".cpp"
                        );

                        try {
                            await vscode.workspace.fs.stat(
                                vscode.Uri.file(filepath)
                            );
                            BPHInstance.showMenu(true, [Menus.GOTO_SDFG, Menus.GOTO_CPP]);
                        } catch (error) {
                            // Do nothing
                        }
                        return;
                    }
                }
                else if (pathName.endsWith(".cpp") && BPHInstance) {
                    const files = BPHInstance.files;
                    const currentFile = normalizePath(pathName);
                    for (const functions of Object.values(files)) {
                        for (const func of functions) {
                            const matchFile = path.join(
                                func.cache,
                                'src',
                                func.target_name,
                                func.name + '.cpp'
                            );
                            if (normalizePath(matchFile) === currentFile) {
                                BPHInstance.currentFunc = func;
                                BPHInstance.showMenu(true, [Menus.GOTO_SDFG, Menus.GOTO_PYTHON]);
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
                    if (func && func.codegen_map) {
                        const codegenLoc = await INSTANCE.getCodegen(
                            position.line + 1,
                            func
                        );
                        if (codegenLoc && codegenLoc.file, codegenLoc.line) {
                            const uri = vscode.Uri.file(codegenLoc.file);
                            let hover_link = new vscode.MarkdownString(
                                `[open CODEGEN]` +
                                `(file://${uri.path}#${codegenLoc.line})`
                            );
                            hover_link.isTrusted = true;
                            let content = {
                                // For nicer highlighting
                                language: 'javascript',
                                value: `${uri.fsPath}:${codegenLoc.line}`
                            };
                            return new vscode.Hover([content, hover_link]);
                        }
                    }
                    return undefined;
                }
            })
        );

        return BreakpointHandler.INSTANCE;
    }

    public registerFunction(data: any) {
        const filePaths: string[] | undefined = data['path_file'];
        const cachePath: string | undefined = data['path_cache'];
        const funcName: string | undefined = data['name'];
        const targetName: string | undefined = data['target_name'];
        const madeWithApi: boolean | undefined = data['made_with_api'];
        const codegenMap: boolean | undefined = data['codegen_map'];

        if (!filePaths || !cachePath || !funcName) {
            return;
        }

        vscode.debug.activeDebugSession?.customRequest("pause");

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
                        target_name: targetName ? targetName : 'cpu',
                        source_files: filePaths.map(file => vscode.Uri.file(file)),
                        made_with_api: madeWithApi ? madeWithApi : false,
                        codegen_map: codegenMap ? codegenMap : false,
                    }
                );
            }
            else {
                alreadySaved.cache = cachePath;
                alreadySaved.target_name = targetName ? targetName : 'cpu';
                alreadySaved.codegen_map = codegenMap ? codegenMap : false;
                alreadySaved.made_with_api = madeWithApi ? madeWithApi : false;
                alreadySaved.source_files = filePaths.map(file => vscode.Uri.file(file));
            }
        }
        this.setAllBreakpoints();
        vscode.debug.activeDebugSession?.customRequest("continue");
        this.showMenu(true, [Menus.GOTO_SDFG, Menus.GOTO_CPP]);
        this.saveState();
    }

    public handleMessage(message: any, origin: any) {
        let node;
        switch (message.type) {
            case 'add_breakpoint':
                node = message.node;
                if (node)
                    BreakpointHandler.getInstance()?.handleNodeAdded(
                        new Node(node.sdfg_id, node.state_id, node.node_id),
                        message.sdfg_name
                    );
                break;
            case 'remove_breakpoint':
                node = message.node;
                if (node)
                    BreakpointHandler.getInstance()?.handleNodeRemoved(
                        new Node(node.sdfg_id, node.state_id, node.node_id),
                        message.sdfg_name
                    );
                break;
            case 'get_saved_nodes':
                BreakpointHandler.getInstance()?.getSavedNodes(message.sdfg_name);
                break;
            case 'has_saved_nodes':
                BreakpointHandler.getInstance()?.hasSavedNodes(message.sdfg_name);
                break;
            default:
                break;
        }
    }

    public setAllBreakpoints() {
        // Map and set all Breakpoints set in the dace (python) code
        vscode.debug.breakpoints.filter(pyFilter).forEach(bp => {
            this.handleBreakpointAdded(bp as vscode.SourceBreakpoint);
        });

        // Map and set all Breakpoints set directly on the sdfg
        Object.entries(this.savedNodes).forEach(([sdfgName, nodes]) => {
            nodes.forEach(async node => {
                if (!node.cache)
                    return;

                const cppMapPath = path.join(node.cache, "map", "map_cpp.json");
                const range = await getCppRange(
                    node,
                    vscode.Uri.file(cppMapPath)
                );
                if (!range || !range.from)
                    return;

                let newBp = this.createBreakpoint(
                    range.from,
                    (node.cache) ? node.cache : '',
                    sdfgName,
                    node.target
                );

                let newIdentifier = this.bpIdentifier(newBp, sdfgName);
                let alreadyExists = this.setBreakpoints.find((bp) => {
                    return bp.identifier === newIdentifier;
                });

                if (!alreadyExists) {
                    vscode.debug.addBreakpoints([newBp]);
                    this.setBreakpoints.push({
                        bp: newBp,
                        identifier: newIdentifier
                    });
                }
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
        let location = await this.pyCppTranslation(
            bp.location.uri,
            bp.location.range.start.line
        );

        // We don't map Breakpoints if the SDFG was created with the API due
        // to the BP already hitting in the python script
        if (!location || location.madeWithApi)
            return;

        let newBp = this.createBreakpoint(
            location.line,
            location.cachePath,
            location.functionName,
            location.target
        );

        const funcName = location.functionName;
        let alreadyExists = this.setBreakpoints.find((bp) => {
            return bp.identifier === this.bpIdentifier(newBp, funcName);
        });
        if (!alreadyExists) {
            this.setBreakpoints.push({
                bp: newBp,
                identifier: this.bpIdentifier(newBp, funcName)
            });
            vscode.debug.addBreakpoints([newBp]);
        }

    }

    public async pyCppTranslation(uri: vscode.Uri, line: number) {
        // Translate a Python Location to a C++ Location
        let filePath = normalizePath(uri.fsPath);
        if (!filePath) {
            return; // Illegal path 
        }

        // If the path hasn't been added yet, then we'll handle the BP
        // later on when the path gets added after compilation of the
        // DaCe program 
        // If the path has been added, then we'll receive an array of
        // registered DaCe function names from that path
        let functions = this.files[filePath];
        if (!functions) {
            return;
        }

        for (let currentFunc of functions) {
            let cachePath = currentFunc.cache;
            // Get the corresponding Node, if the line isn't in the map
            // then we expect it's not part of a DaCe program,
            // hence we do nothing and return 
            const pyMapPath = path.join(cachePath, "map", "map_py.json");
            let nodes = await this.getNode(
                line + 1,
                vscode.Uri.file(pyMapPath),
                uri.fsPath
            );

            if (!nodes || (nodes && nodes.length === 0))
                continue;

            let range;
            for (const node of nodes) {
                const cppMapPath = path.join(cachePath, "map", "map_cpp.json");
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
                target: currentFunc.target_name,
                madeWithApi: currentFunc.made_with_api
            };
        }

        return undefined;
    }

    public async handleNodeAdded(node: Node, sdfgName: string) {
        // Search for the file with the corresponding function information
        let unbound = false;
        for (const functions of Object.values(this.files)) {
            let funcDetails = functions.find(func => {
                return func.name === sdfgName;
            });

            if (funcDetails) {
                node.cache = funcDetails.cache;
                node.sdfg_name = funcDetails.name;
                node.target = funcDetails.target_name;

                const cppMapPath = path.join(node.cache, "map", "map_cpp.json");
                let range = await getCppRange(
                    node,
                    vscode.Uri.file(cppMapPath)
                );

                if (!range || !range.from) {
                    unbound = true;
                    continue;
                }

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

    public handleNodeRemoved(node: Node, sdfgName: string) {
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

    private async getNode(
        line: number,
        path: vscode.Uri,
        src_file: string
    ): Promise<Node[] | undefined> {

        let mapPy = await jsonFromPath(path);
        if (!mapPy)
            return undefined;

        let src_map = mapPy[src_file];

        if (!src_map)
            return undefined;

        let nodesJSON = src_map[line.toString()];
        if (!nodesJSON)
            return undefined;

        if (!Array.isArray(nodesJSON)) {
            let msg = "Source Mapping seems to have the wrong format!";
            vscode.window.showInformationMessage(msg);
            return undefined;
        }

        try {
            nodesJSON.map(node => {
                new Node(
                    node.sdfg_id,
                    node.state_id,
                    node.node_id
                );
            });
        } catch (error) {
            let msg = "Source Mapping seems to have the wrong format!";
            vscode.window.showInformationMessage(msg);
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
        target: string = "cpu"
    ) {
        const cppFile = path.join(
            basePath,
            "src",
            target,
            filename + ".cpp"
        );

        let uri = vscode.Uri.file(cppFile);
        let pos = new vscode.Position(line, 0);
        let location = new vscode.Location(uri, pos);
        let new_bp = new vscode.SourceBreakpoint(location);

        return new_bp;
    }

    private bpIdentifier(
        bp: vscode.SourceBreakpoint,
        sdfgName: string
    ): string {
        // Create an identifier for a Breakpoint location in a C++ file
        let range = bp.location.range;
        return sdfgName + '/' +
            range.start.line + '/' +
            range.start.character + '/' +
            range.end.line + '/' +
            range.end.character + '/';
    }

    public getSavedNodes(sdfgName: string) {
        // Sends the corresponding saved Nodes to the SDFG viewer
        const nodes = this.savedNodes[sdfgName];
        if (nodes !== undefined && nodes.length !== 0)
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                'type': 'saved_nodes',
                'nodes': nodes
            });
    }

    public getAllNodes() {
        let allNodes = [];
        for (const nodes of Object.values(this.savedNodes)) {
            for (const node of nodes) {
                if (node.cache)
                    allNodes.push(node.nodeInfo());
            }
        }
        return allNodes;
    }

    public hasSavedNodes(sdfgName: string) {
        const nodes = this.savedNodes[sdfgName];
        if (nodes !== undefined && nodes.length !== 0)
            DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                'type': 'has_nodes'
            });
    }

    public showMenu(show: boolean, menus: Menus[] | undefined = undefined) {
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

    private async saveState() {
        DaCeVSCode.getExtensionContext()?.workspaceState
            .update('files', this.files);
        DaCeVSCode.getExtensionContext()?.workspaceState
            .update('savedNodes', this.savedNodes);
    }

    private async retrieveState() {
        const context = DaCeVSCode.getExtensionContext();
        if (!context) return;
        this.savedNodes = context.workspaceState.get('savedNodes', {});
        this.files = context.workspaceState.get('files', {});
    }

    public disposeFunction() {
        this.removeAllBreakpoints();
        //this.saveState();
    }
}

export async function getCppRange(node: Node, uri: vscode.Uri) {
    let mapCpp = await jsonFromPath(uri);
    if (!mapCpp) return undefined;

    let states = mapCpp[node.sdfg_id];
    if (!states) return undefined;

    // Return the Range of an entire SDFG
    if (node.state_id === -1) {
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
            'from': minLine,
            'to': maxLine
        };
    }
    let nodes = states[node.state_id];
    if (!nodes) return undefined;

    // Return the Range of an entire State
    if (node.node_id === -1) {
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
            'from': minLine,
            'to': maxLine
        };
    }

    // Return the Range of a single node if it exists
    let cppRange = nodes[node.node_id];
    if (!cppRange) return undefined;
    return cppRange;
    // Returns an Object of the form {'from': _, 'to': _}
}

async function jsonFromPath(fileUri: vscode.Uri) {
    /**
     * Reads the file from the given path and parses it to JSON.
     * Returns undefined if there is an error while reading the file
     * or if the file doesn't exist
     */

    try {
        await vscode.workspace.fs.stat(fileUri);
    } catch (error) {
        // If the file doesn't exist, the program might
        // not have been compiled yet, so we don't throw
        // an error
        return undefined;
    }

    try {
        return vscode.workspace.fs.readFile(fileUri).then(data => {
            return JSON.parse(Buffer.from(data).toString());
        });
    } catch (error) {
        let msg =
            "Error while opening source mapping at: " + fileUri.fsPath +
            "Error code: " + error.code;
        vscode.window.showInformationMessage(msg);
        return undefined;
    }
}

function pyFilter(bp: vscode.Breakpoint) {
    if (!(bp instanceof vscode.SourceBreakpoint))
        return false;
    let sourceBP = bp as vscode.SourceBreakpoint;
    return sourceBP.location.uri.fsPath.endsWith(".py");
}

function normalizePath(path: string): string | undefined {
    let parsedPath;
    try {
        parsedPath = vscode.Uri.parse(path);
    } catch (error) {
        return undefined;
    }
    let splitPath = parsedPath.fsPath.split(":");
    return splitPath[splitPath.length - 1];
}
