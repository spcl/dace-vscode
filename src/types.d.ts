// Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import type { OverlayType } from '@spcl/sdfv/src';

export type MetaDictT = Record<string, unknown> & {
    default?: unknown,
    category?: string,
    __reverse_type_lookup__?: Record<string, unknown>,
    __data_container_types__?: Record<string, unknown>,
};

export interface IOutlineElem {
    icon: string;
    type: string;
    label: string;
    collapsed: boolean;
    uuid: string;
    children: IOutlineElem[];
}

export interface IOverlayDescription {
    class: string;
    label: string;
    type: OverlayType;
}
