import {
    WebviewPanel, TextDocument, CustomDocument, ExtensionContext
} from 'vscode';
import { BaseComponent } from '../base_component';
import { BreakpointHandler } from '../../debugger/breakpoint_handler';
import { TransformationListProvider } from '../transformation_list';
import { DaCeInterface } from '../../dace_interface';


export abstract class SDFGEditorBase extends BaseComponent {

    public constructor(
        context: ExtensionContext,
        public readonly document: TextDocument | CustomDocument
    ) {
        super(context, 'SDFV');
    }

}

export class SDFGEditor extends BaseComponent {

    public constructor(
        context: ExtensionContext,
        public readonly webviewPanel: WebviewPanel,
        public readonly document: TextDocument | CustomDocument
    ) {
        super(context, 'SDFV');
        this.initializeTarget(webviewPanel.webview);

        this.registerRequestHandler(DaCeInterface.getInstance());

        const xfList = TransformationListProvider.getInstance()!;
        this.register(xfList.clearTransformations, xfList);
        this.register(xfList.setTransformations, xfList);

        const bpHandler = BreakpointHandler.getInstance()!;
        this.register(bpHandler.addBreakpoint, bpHandler);
        this.register(bpHandler.removeBreakpoint, bpHandler);
        this.register(bpHandler.getSavedNodes, bpHandler);
        this.register(bpHandler.hasSavedNodes, bpHandler);
    }

}

export class CompressedSDFGEditor extends BaseComponent {
}
