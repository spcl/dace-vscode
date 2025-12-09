// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { AnalysisProvider } from './analysis';
import { DaCeInterface } from './dace_interface';
import { OutlineProvider } from './outline';
import { TransformationHistoryProvider } from './transformation_history';
import { TransformationListProvider } from './transformation_list';

export class OptimizationPanel {

    private static INSTANCE: OptimizationPanel = new OptimizationPanel();

    private constructor() {
        return;
    }

    public static getInstance(): OptimizationPanel {
        return this.INSTANCE;
    }

    public isVisible(): boolean {
        const tlProvider = TransformationListProvider.getInstance();
        const thProvider = TransformationHistoryProvider.getInstance();
        const anProvider = AnalysisProvider.getInstance();
        const olProvider = OutlineProvider.getInstance();
        const daceProvider = DaCeInterface.getInstance();
        return (tlProvider ? tlProvider.isVisible() : false) ||
               (thProvider ? thProvider.isVisible() : false) ||
               (anProvider ? anProvider.isVisible() : false) ||
               (olProvider ? olProvider.isVisible() : false) ||
               (daceProvider ? daceProvider.isVisible() : false);
    }

    public async clearAll(reason: string = 'No SDFG selected'): Promise<void> {
        await Promise.all([
            TransformationListProvider.getInstance()?.invoke(
                'clearTransformations', [reason]
            ),
            TransformationHistoryProvider.getInstance()?.invoke(
                'clearHistory', [reason]
            ),
            AnalysisProvider.getInstance()?.invoke('clear', [reason]),
            OutlineProvider.getInstance()?.invoke('clearOutline', [reason]),
        ]);
    }

}
