# Copyright 2020-2023 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

import sympy as sp
from dace.sdfg.work_depth_analysis.work_depth import analyze_sdfg, get_tasklet_work_depth, get_tasklet_avg_par

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
        depth_map = {}
        analyze_sdfg(sdfg, depth_map, get_tasklet_work_depth)
        for k, v, in depth_map.items():
            depth_map[k] = str(sp.simplify(v[1]))  # only take depth
        return {
            'depthMap': depth_map,
        }
    except Exception as e:
        return {
            'error': {
                'message': 'Failed to analyze depth',
                'details': get_exception_message(e),
            },
        }


def get_avg_parallelism(sdfg_json):
    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    try:
        avg_parallelism_map = {}
        analyze_sdfg(sdfg, avg_parallelism_map, get_tasklet_avg_par)
        for k, v, in avg_parallelism_map.items():
            avg_parallelism_map[k] = str(
                sp.simplify(v[0] / v[1])
                if str(v[1]) != '0' else 0)  # work / depth = avg par
        return {
            'avgParallelismMap': avg_parallelism_map,
        }
    except Exception as e:
        return {
            'error': {
                'message': 'Failed to analyze average parallelism',
                'details': get_exception_message(e),
            },
        }
