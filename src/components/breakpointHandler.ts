import * as vscode from 'vscode';
import { DaCeVSCode } from '../extension';
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
        return this.sdfg_id == node.sdfg_id &&
            this.state_id == node.state_id &&
            this.node_id == node.node_id;
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

    public static activate() {
        BreakpointHandler.INSTANCE = new BreakpointHandler();
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

        let normalizedFilePath = this.normalizePath(filePath);
        if (!normalizedFilePath) {
            return; // Illegal Path
        }

        if (!this.files[normalizedFilePath]) {
            this.files[normalizedFilePath] = [];
        }

        let alreadySaved = this.files[normalizedFilePath].find((elem) => {
            elem.name == funcName
        });

        if (!alreadySaved) {
            this.files[normalizedFilePath].push(
                {
                    "name": funcName,
                    "cache": cachePath.toLowerCase(),
                    "target_name": targetName
                }
            );
        }
        else {
            console.log('already saved ' + funcName);
        }
    }

    public setAllBreakpoints() {
        // Map and set all Breakpoints set in the dace (python) code
        vscode.debug.breakpoints.filter(this.pyFilter).forEach(bp => {
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
        let path = this.normalizePath(bp.location.uri.fsPath);
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


        functions.forEach((currentFunc: IFunction) => {
            let cachePath = currentFunc.cache;

            // Get the corresponding Node, if the line isn't in the map
            // then we expect it's not part of a DaCe program,
            // hence we do nothing and return 
            let node = this.getNode(
                bp.location.range.start.line + 1,
                cachePath + "/map/map_py.json"
            );
            if (!node)
                return;

            let range = getCppRange(
                node,
                cachePath + "/map/map_cpp.json"
            )

            if (!range || !range.from)
                return;

            let newBp = this.createBreakpoint(
                range.from,
                cachePath,
                currentFunc.name,
                currentFunc.target_name
            );

            let alreadyExists = this.setBreakpoints.find((bp) => {
                return bp.identifier === this.bpIdentifier(newBp, currentFunc.name);
            });
            if (!alreadyExists) {
                vscode.debug.addBreakpoints([newBp]);
                this.setBreakpoints.push({
                    bp: newBp,
                    identifier: this.bpIdentifier(newBp, currentFunc.name)
                });
            }
        });


    }

    public handleNodeAdded(node: Node, sdfgName: string) {
        // Creating a Breakpoint for the BP panel
        let uri = vscode.Uri.parse(
            'C:/Users/Benjamin/Documents/Code/Bachelor/dace/.dacecache/myprogram/program.sdfg'
        );
        let pos = new vscode.Position(5, 0);
        let location = new vscode.Location(uri, pos);
        let new_bp = new vscode.SourceBreakpoint(location);
        vscode.debug.addBreakpoints([new_bp]);

        // Search for the file with the corresponding function informations
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

                console.log(range);

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

    private getNode(line: number, path: fs.PathLike): Node | undefined {

        let mapPy = jsonFromPath(path);
        if (!mapPy) {
            return undefined;
        }

        let nodeJSON = mapPy[line.toString()];
        // Return undefined if the line doesn't exist in the mapping
        if (!nodeJSON) {
            return undefined;
        }

        // Make sure the JSON object has the right Properties
        if (
            !nodeJSON.hasOwnProperty('sdfg_id') ||
            !nodeJSON.hasOwnProperty('state_id') ||
            !nodeJSON.hasOwnProperty('node_id')
        ) {
            let msg = "Source Mapping seems to have the wrong format!"
            vscode.window.showInformationMessage(msg);
            return undefined;
        }

        return new Node(
            nodeJSON.sdfg_id,
            nodeJSON.state_id,
            nodeJSON.node_id
        );
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
        let range = bp.location.range
        return sdfgName + '/' +
            range.start.line + '/' +
            range.start.character + '/' +
            range.end.line + '/' +
            range.end.character + '/';
    }

    private normalizePath(path: string): string | undefined {
        let parsedPath;
        try {
            parsedPath = vscode.Uri.parse(path);
        } catch (error) {
            console.log("Illegal Path")
            return undefined
        }
        let splitPath = parsedPath.fsPath.split(":")
        return splitPath[splitPath.length - 1]
    }

    private pyFilter(bp: vscode.Breakpoint) {
        let sourceBP = bp as vscode.SourceBreakpoint;
        return sourceBP.location.uri.fsPath.endsWith(".py");
    }

    private saveState() {
        // Don't save if there is nothing to save or
        // the user doesn't have a Folder open
        let workspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath
        if (
            Object.keys(this.setBreakpoints).length === 0 &&
            Object.keys(this.files).length === 0 &&
            Object.keys(this.savedNodes).length === 0 ||
            !workspace
        ) {
            console.log('nothing to save');
            return;
        }

        let saveLocation = workspace + SAVE_DIR
        if (!fs.existsSync(saveLocation)) {
            fs.mkdirSync(saveLocation);
        }
        saveLocation = saveLocation + SAVE_FILE;

        let data = JSON.stringify({
            "files": this.files,
            "setBreakpoints": this.setBreakpoints,
            "savedNodes": this.savedNodes
        });
        try {
            fs.writeFile(
                saveLocation,
                data,
                () => { console.log(saveLocation) }
            )
            console.log("Saving file")
        } catch (error) {
            console.error("Failed to save to file");
        }


    }

    private retrieveState() {
        let workspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath
        if (!workspace) {
            console.error("not saveing no workspace");
            return;
        }
        let saveLocation = workspace + SAVE_DIR + SAVE_FILE;

        if (!fs.existsSync(saveLocation)) {
            console.log("no save file has been found");
            return;
        }

        let dataBuffer;
        try {
            dataBuffer = fs.readFileSync(saveLocation);
        } catch (error) {
            console.log("Data Buffer error")
            return
        }

        try {
            fs.unlinkSync(saveLocation);
        } catch (error) {
            console.error(error);
        }

        let dataStr = String.fromCharCode(...dataBuffer);
        let dataJson = JSON.parse(dataStr);
        console.log(dataJson)

        let dataFiles = dataJson.files;
        if (dataFiles) {
            this.files = dataFiles;
        }

        let dataSetBreakpoints = dataJson.setBreakpoints;
        if (dataSetBreakpoints) {
            this.setBreakpoints = dataSetBreakpoints;
        }

        let savedNodes = dataJson.savedNodes;
        if (savedNodes) {
            this.savedNodes = savedNodes;
        }

    }

    public getSavedNodes(sdfgName: string) {
        console.log(this.savedNodes);
        DaCeVSCode.getInstance().getActiveEditor()?.postMessage({
            'type': 'saved_nodes',
            'nodes': this.savedNodes[sdfgName]
        });
    }

    public disposeFunction() {
        // Remove all Breakpoints that are still set
        this.setBreakpoints.forEach(savedBp => {
            vscode.debug.removeBreakpoints([savedBp.bp]);
        });
        this.setBreakpoints = [];
        this.saveState();
    }
}

export function getCppRange(node: Node, path: fs.PathLike) {
    let mapCpp = jsonFromPath(path);
    if (!mapCpp) return undefined

    let states = mapCpp[node.sdfg_id];
    if (!states) return undefined

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
                    maxLine = node.to
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