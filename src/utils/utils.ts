// Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as path from 'path';
import {
    FileType,
    Position,
    Range,
    TabInputText,
    TextDocument,
    Uri,
    ViewColumn,
    env,
    window,
    workspace
} from 'vscode';
import { SDFGDebugNode, getCppRange } from '../debugger/breakpoint_handler';

export async function fileExists(uri: Uri): Promise<boolean> {
    try {
        await workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

export function goToFileLocation(
    fileUri: Uri, startLine: number, startCol: number, endLine: number,
    endCol: number
): void {
    // Load the file and show it in a new editor, highlighting the
    // indicated range. If the file is open already, open the opened editor
    // instead of loading the file.
    const _goToFileLoc = (doc: TextDocument) => {
        const startPos = new Position(startLine - 1, startCol);
        const endPos = new Position(endLine, endCol);
        const range = new Range(startPos, endPos);
        window.showTextDocument(doc, {
            viewColumn: ViewColumn.Beside,
            preview: false,
            selection: range,
        });
    }

    let document = null;
    for (const doc of workspace.textDocuments) {
        if (doc.uri.fsPath === fileUri.fsPath)
            document = doc;
    }
    if (document) {
        _goToFileLoc(document);
    } else {
        workspace.openTextDocument(fileUri).then(
            (doc: TextDocument) => {
                _goToFileLoc(doc);
            }, (reason) => {
                window.showInformationMessage(
                    'Could not open file ' + fileUri.fsPath + ', ' + reason
                );
            }
        );
    }
}

export async function goToSource(
    pFilePath: string, startRow: number, startChar: number, endRow: number,
    endChar: number
): Promise<void> {
    // We want to jump to a specific file and location if it exists.
    let fPath: Uri | null = null;
    if (path.isAbsolute(pFilePath)) {
        fPath = Uri.file(pFilePath);
    } else if (workspace.workspaceFolders) {
        // If the provided path is relative, search through the open
        // workspace folders to see if one contains a file at the
        // provided relative path.
        for (const wsFolder of workspace.workspaceFolders) {
            const filePathCandidate = Uri.joinPath(
                wsFolder.uri, pFilePath
            );
            if (await fileExists(filePathCandidate)) {
                fPath = filePathCandidate;
                break;
            }
        }
    } else {
        window.showErrorMessage(
            'Cannot jump to the relative path ' + pFilePath +
            ' without a folder open in VSCode.'
        );
        return;
    }

    if (fPath)
        goToFileLocation(fPath, startRow, startChar, endRow, endChar);
}

export async function goToGeneratedCode(
    sdfgName: string, sdfgId: number, stateId: number, nodeId: number,
    cachePath?: string,
): Promise<void> {
    // If the message passes a cache path then use that path,
    // otherwise reconstruct the folder based on the default cache
    // directory with respect to the opened workspace folder and the
    // SDFG name.
    let cacheUri: Uri | null = null;
    const cPath: string = cachePath ?? path.join(
        '.', '.dacecache', sdfgName
    );
    if (path.isAbsolute(cPath)) {
        cacheUri = Uri.file(cPath);
    } else if (workspace.workspaceFolders) {
        // If the provided path is relative, search through the open
        // workspace folders to see if one contains a file at the
        // provided relative path.
        for (const wsFolder of workspace.workspaceFolders) {
            const cacheUriCandidate = Uri.joinPath(
                wsFolder.uri, cPath
            );
            if (await fileExists(cacheUriCandidate)) {
                cacheUri = cacheUriCandidate;
                break;
            }
        }
    } else {
        window.showErrorMessage(
            'Cannot jump to the relative path ' + cPath +
            'without a folder open in VSCode.'
        );
        return;
    }

    if (!cacheUri)
        return;

    const cppMapUri = Uri.joinPath(
        cacheUri, 'map', 'map_cpp.json'
    );
    const cppFileUri = Uri.joinPath(
        cacheUri, 'src', 'cpu', sdfgName + '.cpp'
    );
    const node = new SDFGDebugNode(sdfgId, stateId, nodeId);

    getCppRange(node, cppMapUri).then(lineRange => {
        // If there is no matching location we just goto the file
        // without highlighting and indicate it with a message
        if (!lineRange || !lineRange.from) {
            lineRange = { to: Number.MAX_VALUE, from: 0 };
            lineRange.from = 1;
            window.showInformationMessage(
                'Could not find a specific line for Node:' +
                node.printer()
            );
        }

        // Subtract 1 as we don't want to highlight the first line
        // as the 'to' value is inclusive
        if (!lineRange.to)
            lineRange.to = lineRange.from - 1;

        goToFileLocation(cppFileUri, lineRange.from - 1, 0, lineRange.to, 0);
    });
}

export async function* walkDirectory(
    dir: Uri, filter?: string
): AsyncGenerator<Uri> {
    const files = await workspace.fs.readDirectory(dir);
    for (const [fname, ftype] of files) {
        if (ftype === FileType.Directory) {
            yield* walkDirectory(Uri.joinPath(dir, fname), filter);
        } else {
            if (filter) {
                if (fname.endsWith(filter))
                    yield Uri.joinPath(dir, fname);
            } else {
                yield Uri.joinPath(dir, fname);
            }
        }
    }
}

export function showUntrustedWorkspaceWarning(
    customFeatureMsg?: string, callback?: (e: void) => any
): void {
    const trustWorkspaceMsg = 'Trust this workspace';
    window.showErrorMessage(
        (customFeatureMsg ? customFeatureMsg : 'This feature') +
        ' is disabled in untrusted workspaces to keep you safe. ' +
        'If you trust the workspace, you can disable restricted mode to use ' +
        'this feature.',
        trustWorkspaceMsg
    ).then((val) => {
        if (val === trustWorkspaceMsg)
            env.openExternal(Uri.parse(
                'https://code.visualstudio.com/docs/editor/workspace-trust' +
                '#_trusting-a-workspace'
            ));
    });

    if (callback !== undefined)
        workspace.onDidGrantWorkspaceTrust(callback);
}

export function executeTrusted(
    f: (e: void) => any, runOnTrusted: boolean = false, customMessage?: string
): void {
    if (workspace.isTrusted)
        f();
    else
        showUntrustedWorkspaceWarning(
            customMessage, runOnTrusted ? f : undefined
        );
}
