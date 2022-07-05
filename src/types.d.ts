// Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

export type Range = {
    start: number | string | string[] | undefined | null,
    end: number | string | string[] | undefined | null,
    tile: number | string | string[] | undefined | null,
    step: number | string | string[] | undefined | null,
};