// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
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
