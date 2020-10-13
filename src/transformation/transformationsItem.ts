import * as vscode from 'vscode';
import * as path from 'path';

export class BaseTransformationItem extends vscode.TreeItem {
}

export class TransformationCategory extends BaseTransformationItem {

    contextValue = 'transformationCategory';

    constructor(
        public readonly label: string,
        public readonly tooltip: string,
        public readonly expanded: boolean,
        private transformations: Transformation[]
    ) {
        super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    }

    public addTransformation(transformation: Transformation) {
        this.transformations.push(transformation);
    }

    public getTransformations() {
        return this.transformations;
    }

    public clearTransformations() {
        this.transformations = [];
    }

    public setTransformations(transformations: Transformation[]) {
        this.transformations = transformations;
    }

}

export class Transformation extends BaseTransformationItem {

    contextValue = 'transformation';

    iconPath = {
        light: path.join(
            __filename, '..', '..', '..',
            'resources', 'icon-theme', 'sdfg.svg'
        ),
        dark: path.join(
            __filename, '..', '..', '..',
            'resources', 'icon-theme', 'sdfg.svg'
        ),
    };

    constructor(
        public readonly label: string,
        public readonly json: any,
        public readonly tooltip: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }

    command = {
        command: 'sdfg.previewTransformation',
        title: '',
        arguments: [this],
    };

}

export class SubgraphTransformation extends Transformation {
}