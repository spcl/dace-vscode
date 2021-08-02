// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import { SDFGElement } from '@spcl/sdfv';

class CustomTreeViewItem {

    private parentItem: CustomTreeViewItem | undefined = undefined;
    private children: CustomTreeViewItem[] | undefined = undefined;
    private list: CustomTreeView | undefined = undefined;

    constructor(
        private label: string,
        private tooltip: string | undefined,
        private icon: string | undefined,
        private initCollapsed: boolean,
        private unfoldDoubleClick: boolean,
        private labelStyle: string | undefined = undefined,
        private iconStyle: string | undefined = undefined
    ) {
    }

}

class CustomTreeView {
}