// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import { DaCeVSCode } from '../extension';
import { SdfgViewerProvider } from "../components/sdfgViewer";
import fs = require("fs");

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
    target_name: string
}

interface IHashFiles {
    [key: string]: IFunction[];
}

interface IHashNodes {
    [key: string]: Node[];
}

const SAVE_DIR = "/.vscode/";
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
        vscode.commands.executeCommand('setContext', 'sdfg.showMenuCommands', false);
        this.retrieveState();

        // When a debug session terminates and there isn't any active session
        // remove all C++ breakpoints
        vscode.debug.onDidTerminateDebugSession(res => {
            if (!vscode.debug.activeDebugSession)
                this.removeAllBreakpoints();
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
                (resource: vscode.Uri) => {
                    if (resource) {
                        let files = BreakpointHandler.getInstance()?.files;
                        let path = normalizePath(resource.fsPath);

                        // Check if there is a corresponding SDFG file saved
                        // If thats the case, display the SDFG
                        if (files && path && files[path].length !== 0) {
                            SdfgViewerProvider.getInstance()?.goToFileLocation(
                                vscode.Uri.file(
                                    files[path][0].cache +
                                    "/program.sdfg"
                                ),
                                0, 0, 0, 0
                            );
                        }
                    }
                }
            ),
            vscode.commands.registerCommand(
                'sdfg.goto.cpp',
                (resource: vscode.Uri) => {
                    if (resource) {
                        const editor = vscode.window.activeTextEditor;
                        const position = editor?.selection.active;
                        const BPHinstance = BreakpointHandler.getInstance();

                        // Translate the current cursor position to a C++ Line
                        let location;
                        if (position && editor && editor.document)
                            location = BPHinstance?.pyCppTranslation(
                                editor.document.uri,
                                position.line
                            );

                        // Check if there is a corresponding C++ file saved
                        let files = BPHinstance?.files;
                        let path = normalizePath(resource.fsPath);
                        if (files && path && files[path].length !== 0) {
                            // Jump to the corresponding location in
                            // the C++ file
                            // TODO: look through list for the right file as one 
                            //      src file might have multiple Dace programs
                            let file = files[path][0]
                            SdfgViewerProvider.getInstance()?.goToFileLocation(
                                vscode.Uri.file(
                                    file.cache + "/src/" +
                                    file.target_name + "/" +
                                    file.name + ".cpp"
                                ),
                                location ? location.line : 0, 0,
                                location ? location.line : 0, 0
                            )
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
                if (pathName.endsWith(".py")) {
                    let files = BreakpointHandler.getInstance()?.files;
                    let path = normalizePath(pathName);
                    // Check if there are corresponding C++ & SDFG files saved
                    // If so, display the Menus
                    if (files && path && files[path] && files[path].length !== 0) {
                        let file = files[path][0];
                        let filepath = file.cache + "/src/" +
                            file.target_name + "/" +
                            file.name + ".cpp";
                        
                        try {
                            await vscode.workspace.fs.stat(vscode.Uri.parse(filepath));
                            vscode.commands.executeCommand('setContext', 'sdfg.showMenuCommands', true);
                        } catch (error) {
                            vscode.commands.executeCommand('setContext', 'sdfg.showMenuCommands', false);
                        }
                        return;
                    }
                }
                vscode.commands.executeCommand('setContext', 'sdfg.showMenuCommands', false);
            })
        );

        return BreakpointHandler.INSTANCE;
    }

    public registerFunction(data: any) {
        let filePath = data['path_file'];
        let cachePath = data['path_cache'];
        let funcName = data['name'];
        let targetName = data['target_name'];

        if (!filePath || !cachePath || !funcName) {
            return;
        }

        /**
         * For each path save the name and the folder path
         * of the function in 'files'
         */

        let normalizedFilePath = normalizePath(filePath);
        if (!normalizedFilePath) {
            return; // Illegal Path
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
                    "name": funcName,
                    "cache": cachePath.toLowerCase(),
                    "target_name": targetName
                }
            );
            vscode.debug.activeDebugSession?.customRequest("pause");
            this.setAllBreakpoints();
            vscode.debug.activeDebugSession?.customRequest("continue");
        }

        vscode.commands.executeCommand('setContext', 'sdfg.showMenuCommands', true);
    }

    public setAllBreakpoints() {
        // Map and set all Breakpoints set in the dace (python) code
        vscode.debug.breakpoints.filter(pyFilter).forEach(bp => {
            this.handleBreakpointAdded(bp as vscode.SourceBreakpoint);
        });

        // Map and set all Breakpoints set directly on the sdfg
        Object.entries(this.savedNodes).forEach(([sdfgName, nodes]) => {
            nodes.forEach(node => {
                let range = getCppRange(
                    node,
                    node.cache + "/map/map_cpp.json"
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

    private handleBreakpointAdded(bp: vscode.SourceBreakpoint) {
        let location = this.pyCppTranslation(
            bp.location.uri,
            bp.location.range.start.line
        );

        if (!location) {
            console.log("no location found");
            return;
        }

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

    public pyCppTranslation(uri: vscode.Uri, line: number) {
        // Translate a Python Location to a C++ Location
        let path = normalizePath(uri.fsPath);
        if (!path) {
            return; // Illegal path 
        }

        // If the path hasn't been added yet, then we'll handle the BP
        // later on when the path gets added after compilation of the
        // DaCe program 
        // If the path has been added, then we'll receive an array of
        // registered DaCe function names from that path
        let functions = this.files[path];
        if (!functions) {
            return;
        }

        for (let currentFunc of functions) {
            let cachePath = currentFunc.cache;

            // Get the corresponding Node, if the line isn't in the map
            // then we expect it's not part of a DaCe program,
            // hence we do nothing and return 
            let nodes = this.getNode(
                line + 1,
                cachePath + "/map/map_py.json"
            );
            if (!nodes || (nodes && nodes.length === 0))
                continue;

            let range;
            for (const node of nodes) {
                range = getCppRange(
                    node,
                    cachePath + "/map/map_cpp.json"
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
                target: currentFunc.target_name
            }
        }

        return undefined;
    }

    public handleNodeAdded(node: Node, sdfgName: string) {
        // Search for the file with the corresponding function information
        Object.values(this.files).forEach(functions => {
            let funcDetails = functions.find(func => {
                return func.name === sdfgName;
            });

            if (funcDetails) {
                node.cache = funcDetails.cache;
                node.sdfg_name = funcDetails.name;
                node.target = funcDetails.target_name;

                let range = getCppRange(
                    node,
                    node.cache + "/map/map_cpp.json"
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
    }

    public handleNodeRemoved(node: Node, sdfgName: string) {
        if (this.savedNodes[sdfgName])
            this.savedNodes[sdfgName].forEach((n, i, _) => {
                if (node.isEqual(n)) {
                    this.savedNodes[sdfgName].splice(i, 1);
                    return;
                }
            });
    }

    private getNode(line: number, path: string): Node[] | undefined {

        let mapPy = jsonFromPath(path);
        if (!mapPy) {
            return undefined;
        }

        let nodesJSON = mapPy[line.toString()];
        // Return undefined if the line doesn't exist in the mapping
        if (!nodesJSON) {
            return undefined;
        }

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
        type: string = "cpu"
    ) {
        let uri = vscode.Uri.parse(
            basePath +
            "/src/" +
            type +
            "/" +
            filename +
            ".cpp"
        );

        let pos = new vscode.Position(line, 0);
        let location = new vscode.Location(uri, pos);
        let new_bp = new vscode.SourceBreakpoint(location);

        return new_bp;
    }

    private bpIdentifier(bp: vscode.SourceBreakpoint, sdfgName: string): string {
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

    private saveState() {
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

        let saveLocation = workspace + SAVE_DIR;
        if (!fs.existsSync(saveLocation)) {
            fs.mkdirSync(saveLocation);
        }
        saveLocation = saveLocation + SAVE_FILE;

        let data = JSON.stringify({
            "files": this.files,
            "savedNodes": this.savedNodes
        });
        try {
            fs.writeFile(
                saveLocation,
                data,
                () => { console.log(saveLocation) }
            );
        } catch (error) {
            console.error("Failed to save to file");
        }
    }

    private retrieveState() {
        let workspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspace) {
            console.error("not saving no workspace");
            return;
        }
        let saveLocation = workspace + SAVE_DIR + SAVE_FILE;

        if (!fs.existsSync(saveLocation)) {
            return;
        }

        let dataBuffer;
        try {
            dataBuffer = fs.readFileSync(saveLocation);
        } catch (error) {
            console.error(error);
            return
        }

        try {
            fs.unlinkSync(saveLocation);
        } catch (error) {
            console.error(error);
        }

        let dataStr = String.fromCharCode(...dataBuffer);
        let dataJson = JSON.parse(dataStr);

        let dataFiles = dataJson.files;
        if (dataFiles) {
            this.files = dataFiles;
        }

        let savedNodes = dataJson.savedNodes;
        if (savedNodes) {
            this.savedNodes = savedNodes;
        }
    }

    public disposeFunction() {
        // Remove all Breakpoints that are still set
        this.setBreakpoints.forEach(savedBp => {
            vscode.debug.removeBreakpoints([savedBp.bp]);
        });
        this.saveState();
    }
}

export function getCppRange(node: Node, path: fs.PathLike) {
    let mapCpp = jsonFromPath(path);
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

function jsonFromPath(path: fs.PathLike) {
    /**
     * Reads the file from the given path and parses it to JSON.
     * Returns undefined if there is an error while reading the file
     * or if the file doesn't exist
     */

    if (!fs.existsSync(path)) {
        return undefined;
    }

    let data;
    try {
        data = fs.readFileSync(path, { encoding: 'utf8', flag: 'r' });
    } catch (error) {
        let msg =
            "Error while opening source mapping at: " + path +
            "Error code: " + error.code;
        vscode.window.showInformationMessage(msg);
        return undefined;
    }
    return JSON.parse(data);
}

function pyFilter(bp: vscode.Breakpoint) {
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
