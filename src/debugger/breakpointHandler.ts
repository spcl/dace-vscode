// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import * as vscode from 'vscode';
import { DaCeVSCode } from '../extension';
import { SdfgViewerProvider } from "../components/sdfgViewer";

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
}

interface ISavedBP {
    bp: vscode.SourceBreakpoint,
    identifier: string
}

interface IFunction {
    name: string,
    cache: string,
    target_name: string,
    made_with_api: boolean
}

interface IHashFiles {
    [key: string]: IFunction[];
}

interface IHashNodes {
    [key: string]: Node[];
}

const SAVE_DIR = ".vscode";
const SAVE_FILE = "daceDebugState.json";

export class BreakpointHandler extends vscode.Disposable {

    private static INSTANCE: BreakpointHandler | undefined = undefined;

    // file path -> array of IFunction (name, cache, target_name)
    files: IHashFiles;

    // Save nodes
    savedNodes: IHashNodes;

    // Save all Breakpoints set in the C++ code for later removal
    setBreakpoints: ISavedBP[];

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
        vscode.debug.onDidChangeBreakpoints(_ => {});
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
                        let files = BreakpointHandler.getInstance()?.files;
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
                            SdfgViewerProvider.getInstance()?.goToFileLocation(
                                vscode.Uri.file(sdfgPath),
                                0, 0, 0, 0
                            );
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
                            BPHInstance.showMenu(true);
                        } catch (error) {
                            BPHInstance.showMenu(false);
                        }
                        return;
                    }
                }
                BPHInstance?.showMenu(false);
            })
        );

        return BreakpointHandler.INSTANCE;
    }

    public registerFunction(data: any) {
        const filePaths: string[] | undefined = data['path_file'];
        const cachePath: string | undefined = data['path_cache'];
        const funcName: string | undefined = data['name'];
        const targetName: string | undefined = data['target_name'];
        const madeWithApi: boolean | undefined = data['made_with_api']

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
                        made_with_api: madeWithApi ? madeWithApi : false
                    }
                );
            }
            // In case the user changes it's cache settings or changes the target
            else if (alreadySaved.cache != cachePath ||
                alreadySaved.target_name != targetName) {
                alreadySaved.cache = cachePath;
                alreadySaved.target_name = targetName ? targetName : 'cpu';
            }
        }
        
        this.setAllBreakpoints();
        vscode.debug.activeDebugSession?.customRequest("continue");
        this.showMenu(true);
        this.saveState();
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
            }
        }

        return undefined;
    }

    public handleNodeAdded(node: Node, sdfgName: string) {
        // Search for the file with the corresponding function information
        Object.values(this.files).forEach(async functions => {
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
                    DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
                        'type': 'unbound_breakpoint',
                        'node': node
                    });
                    return;
                }

                if (!this.savedNodes[sdfgName])
                    this.savedNodes[sdfgName] = [];
                this.savedNodes[sdfgName].push(node);
                return;
            }
        });

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
            return undefined

        let nodesJSON = src_map[line.toString()];
        if (!nodesJSON)
            return undefined;

        if (!Array.isArray(nodesJSON)) {
            let msg = "Source Mapping seems to have the wrong format!"
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
        DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
            'type': 'saved_nodes',
            'nodes': this.savedNodes[sdfgName]
        });
    }

    public showMenu(show: boolean) {
        vscode.commands.executeCommand(
            'setContext',
            'sdfg.showMenuCommands',
            show
        );
    }

    private async saveState() {
        // Don't save if there is nothing to save or
        // the user doesn't have a Folder open
        let workspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (
            Object.keys(this.files).length === 0 &&
            Object.keys(this.savedNodes).length === 0 ||
            !workspace
        ) {
            return;
        }

        const dirUri = vscode.Uri.file(path.join(workspace, SAVE_DIR));
        const fileUri = vscode.Uri.file(path.join(workspace, SAVE_DIR,
            SAVE_FILE));

        // Check if the SAVE DIR exists, otherwise create it
        try {
            await vscode.workspace.fs.stat(dirUri);
        } catch (error) {
            try {
                await vscode.workspace.fs.createDirectory(dirUri);
            } catch (err) {
                console.error("Error while creating the save folder:\n", err);
            }
        }

        // Check if the SAVE FILE exists, otherwise create it
        try {
            await vscode.workspace.fs.stat(fileUri);
        } catch (error) {
            const we = new vscode.WorkspaceEdit();
            we.createFile(fileUri);
            try {
                await vscode.workspace.applyEdit(we);
            } catch (err) {
                console.error("Error while creating the save file:\n", err);
                return;
            }
        }

        let data = JSON.stringify({
            "files": this.files,
            "savedNodes": this.savedNodes
        });

        // Write to the SAVE FILE 
        try {
            await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(data, 'utf8')
            );
        } catch (error) {
            console.error("Error while writting to the save file:\n", error);
        }
    }

    private async retrieveState() {
        let workspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspace)
            return;

        const fileUri = vscode.Uri.file(
            path.join(workspace, SAVE_DIR, SAVE_FILE)
        );
        try {
            // Check if a save file exists
            await vscode.workspace.fs.stat(fileUri);
        } catch (error) {
            return;
        }

        try {
            vscode.workspace.fs.readFile(fileUri).then(dataBuffer => {

                let dataStr = Buffer.from(dataBuffer).toString();
                let dataJson = JSON.parse(dataStr);

                let dataFiles = dataJson.files;
                if (dataFiles) {
                    this.files = dataFiles;
                }

                let savedNodes = dataJson.savedNodes;
                if (savedNodes) {
                    this.savedNodes = savedNodes;
                }
            });
        } catch (error) {
            return;
        }
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
        }
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
                maxLine = node.to
        });
        return {
            'from': minLine,
            'to': maxLine
        }
    }

    // Return the Range of a single node if it exists
    let cppRange = nodes[node.node_id];
    if (!cppRange) return undefined
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
        // an errror
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
