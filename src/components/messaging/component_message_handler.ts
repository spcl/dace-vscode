// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import { DaCeInterface } from '../../dace_interface';

import { OutlineProvider } from '../outline';
import { SdfgViewerProvider } from '../sdfg_viewer';
import { AnalysisProvider } from '../analysis';
import { SdfgBreakpointProvider } from '../sdfg_breakpoints';
import { TransformationListProvider } from '../transformation_list';
import { TransformationHistoryProvider } from '../transformation_history';
import { BreakpointHandler } from '../../debugger/breakpoint_handler';
import { DaceListener } from '../../debugger/dace_listener';

export class ComponentMessageHandler {

    private static INSTANCE: ComponentMessageHandler =
        new ComponentMessageHandler();

    private constructor() {
    }

    public static getInstance(): ComponentMessageHandler {
        return this.INSTANCE;
    }

    public handleMessage(message: any, origin: vscode.Webview) {
        if (message.type !== undefined) {
            const [target, type] = message.type.split('.');
            message.type = type;
            switch (target) {
                case 'sdfv':
                    SdfgViewerProvider.getInstance()?.handleMessage(
                        message,
                        origin
                    );
                    break;
                case 'outline':
                    OutlineProvider.getInstance()?.handleMessage(
                        message,
                        origin
                    );
                    break;
                case 'analysis':
                    AnalysisProvider.getInstance()?.handleMessage(
                        message,
                        origin
                    );
                    break;
                case 'sdfgBreakpoints':
                    SdfgBreakpointProvider.getInstance()?.handleMessage(
                        message,
                        origin
                    );
                    break;
                case 'dace':
                    DaCeInterface.getInstance().handleMessage(message, origin);
                    break;
                case 'transformation_history':
                    TransformationHistoryProvider.getInstance()?.handleMessage(
                        message,
                        origin
                    );
                    break;
                case 'transformation_list':
                    TransformationListProvider.getInstance()?.handleMessage(
                        message,
                        origin
                    );
                    break;
                case 'bp_handler':
                    BreakpointHandler.getInstance()?.handleMessage(
                        message,
                        origin
                    );
                    break;
                case 'dace_listener':
                    DaceListener.getInstance()?.handleMessage(
                        message,
                        origin
                    );
                    break;
                default:
                    break;
            }
        }
    }

}