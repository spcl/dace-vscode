# Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

import sympy as sp
from dace.sdfg.work_depth_analysis.work_depth import analyze_sdfg, get_tasklet_work_depth


from dace_vscode.utils import (
    load_sdfg_from_json,
    get_exception_message,
)


def get_depth(sdfg_json):
    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    try:
        work_depth_map = {}
        analyze_sdfg(sdfg, work_depth_map, get_tasklet_work_depth)
        for k, v, in work_depth_map.items():
            work_depth_map[k] = str(sp.simplify(v[1]))  # only take depth
        return {
            'workDepthMap': work_depth_map,
        }
    except Exception as e:
        return {
            'error': {
                'message': 'Failed to analyze work depth',
                'details': get_exception_message(e),
            },
        }