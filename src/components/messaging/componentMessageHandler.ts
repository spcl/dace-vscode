// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import { DaCeInterface } from '../../daceInterface';

import { OutlineProvider } from "../outline";
import { SdfgViewerProvider } from "../sdfgViewer";
import { AnalysisProvider } from "../analysis";
import { TransformationListProvider } from '../transformationList';
import { TransformationHistoryProvider } from '../transformationHistory';

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
            switch(target) {
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
                default:
                    break;
            }
        }
    }

}