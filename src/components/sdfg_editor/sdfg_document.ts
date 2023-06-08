import * as vscode from 'vscode';

interface CompressedSDFGEdit {
}

interface CompressedSDFGDocumentDelegate {
    getFileData(): Promise<Uint8Array>;
}

interface CompressedSDFGDocumentChangedEvent {
    readonly content?: Uint8Array;
    readonly edits: readonly CompressedSDFGEdit[];
}

export class CompressedSDFGDocument implements vscode.CustomDocument {

    private readonly _uri: vscode.Uri;
    private readonly _delegate: CompressedSDFGDocumentDelegate;
    private _dirty: boolean = false;

    // Fired when the document is disposed of.
    private readonly _onDidDispose = new vscode.EventEmitter<void>();
    public readonly onDidDispose = this._onDidDispose.event;

    // Fired to notify webviews that the document has changed.
    private readonly _onDidChangeDocument =
        new vscode.EventEmitter<CompressedSDFGDocumentChangedEvent>();
    public readonly onDidChangeContent = this._onDidChangeDocument.event;

    // Fired to tell VSCode that an edit has occurred in the document and
    // to update the dirty indicator.
    private readonly _onDidChange = new vscode.EventEmitter<{
        readonly label: string;
        undo(): void;
        redo(): void;
    }>();
    public readonly onDidChange = this._onDidChange.event;

    private readonly _disposable = vscode.Disposable.from(
        this._onDidDispose, this._onDidChangeDocument, this._onDidChange
    );

    private _documentData: Uint8Array;
    private _edits: CompressedSDFGEdit[] = [];
    private _savedEdits: CompressedSDFGEdit[] = [];

    private constructor(
        uri: vscode.Uri, initialContent: Uint8Array,
        delegate: CompressedSDFGDocumentDelegate
    ) {
        this._uri = uri;
        this._documentData = initialContent;
        this._delegate = delegate;
    }

    static async create(
        uri: vscode.Uri, backupId: string | undefined,
        delegate: CompressedSDFGDocumentDelegate
    ): Promise<CompressedSDFGDocument> {
        const dataFile = typeof backupId === 'string' ?
            vscode.Uri.parse(backupId) : uri;
        const fileData = await CompressedSDFGDocument.readFile(dataFile);
        return new CompressedSDFGDocument(uri, fileData, delegate);
    }

    private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (uri.scheme === 'untitled')
            return new Uint8Array();
        return new Uint8Array(await vscode.workspace.fs.readFile(uri));
    }

    public dispose(): void {
        this._onDidDispose.fire();
        this._disposable.dispose();
    }

    public makeEdit(edit: CompressedSDFGEdit): void {
        console.log('Recorded edit', edit);
        this._edits.push(edit);
        this._onDidChange.fire({
            label: 'Edit',
            undo: async () => {
                this._edits.pop();
                this._onDidChangeDocument.fire({
                    edits: this._edits,
                });
            },
            redo: async () => {
                this._edits.push(edit);
                this._onDidChangeDocument.fire({
                    edits: this._edits,
                });
            },
        });
        this._dirty = true;
    }

    public get uri(): vscode.Uri {
        return this._uri;
    }

    public get documentData(): Uint8Array {
        return this._documentData;
    }

    public async save(token?: vscode.CancellationToken): Promise<boolean> {
        const retval = this.saveAs(this.uri, token);
        this._savedEdits = this._edits.slice();
        return retval;
    }

    public async saveAs(
        targetResource: vscode.Uri, token?: vscode.CancellationToken
    ): Promise<boolean> {
        const fileData = await this._delegate.getFileData();
        if (token && token.isCancellationRequested)
            return false;
        try {
            await vscode.workspace.fs.writeFile(targetResource, fileData);
            this._dirty = false;
            return true;
        } catch (_) {
            return false;
        }
    }

    public async revert(
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        const diskContent = await CompressedSDFGDocument.readFile(this.uri);
        this._documentData = diskContent;
        this._edits = this._savedEdits;
        this._onDidChangeDocument.fire({
            content: diskContent,
            edits: this._edits,
        });
        this._dirty = false;
    }

    public async backup(
        destination: vscode.Uri, cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        await this.saveAs(destination, cancellation);
        return {
            id: destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(destination);
                } catch {
                    // noop
                }
            }
        };
    }

    public get isDirty(): boolean {
        return this._dirty;
    }

}
