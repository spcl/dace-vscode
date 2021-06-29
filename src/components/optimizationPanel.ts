// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { AnalysisProvider } from "./analysis";
import { OutlineProvider } from "./outline";
import { TransformationHistoryProvider } from "./transformationHistory";
import { TransformationListProvider } from "./transformationList";

export class OptimizationPanel {

    private static INSTANCE: OptimizationPanel = new OptimizationPanel();

    private constructor() {}

    public static getInstance(): OptimizationPanel {
        return this.INSTANCE;
    }

    public isVisible(): boolean {
        const tlProvider = TransformationListProvider.getInstance();
        const thProvider = TransformationHistoryProvider.getInstance();
        const anProvider = AnalysisProvider.getInstance();
        const olProvider = OutlineProvider.getInstance();
        return (tlProvider ? tlProvider.isVisible() : false) ||
               (thProvider ? thProvider.isVisible() : false) ||
               (anProvider ? anProvider.isVisible() : false) ||
               (olProvider ? olProvider.isVisible() : false);
    }

}
