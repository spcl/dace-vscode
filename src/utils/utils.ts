// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';

export async function* walkDirectory(
    dir: vscode.Uri, filter?: string
): AsyncGenerator<vscode.Uri> {
    const files = await vscode.workspace.fs.readDirectory(dir);
    for (const [fname, ftype] of files) {
        if (ftype === vscode.FileType.Directory) {
            yield* walkDirectory(vscode.Uri.joinPath(dir, fname), filter);
        } else {
            if (filter) {
                if (fname.endsWith(filter))
                    yield vscode.Uri.joinPath(dir, fname);
            } else {
                yield vscode.Uri.joinPath(dir, fname);
            }
        }
    }
}

export function showUntrustedWorkspaceWarning(
    customFeatureMsg?: string, callback?: (e: void) => any
): void {
    const trustWorkspaceMsg = 'Trust this workspace';
    vscode.window.showErrorMessage(
        (customFeatureMsg ? customFeatureMsg : 'This feature') +
        ' is disabled in untrusted workspaces to keep you safe. ' +
        'If you trust the workspace, you can disable restricted mode to use ' +
        'this feature.',
        trustWorkspaceMsg
    ).then((val) => {
        if (val === trustWorkspaceMsg)
            vscode.env.openExternal(vscode.Uri.parse(
                'https://code.visualstudio.com/docs/editor/workspace-trust' +
                '#_trusting-a-workspace'
            ));
    });

    if (callback !== undefined)
        vscode.workspace.onDidGrantWorkspaceTrust(callback);
}

export function executeTrusted(
    f: (e: void) => any, runOnTrusted: boolean = false, customMessage?: string
): void {
    if (vscode.workspace.isTrusted)
        f();
    else
        showUntrustedWorkspaceWarning(
            customMessage, runOnTrusted ? f : undefined
        );
}
