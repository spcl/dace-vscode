# Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

from typing import Any

import sympy as sp
try:
    from dace.sdfg.performance_evaluation import work_depth
except ImportError:
    work_depth = None

from dace_vscode.utils import (
    load_sdfg_from_json,
    get_exception_message,
)

def get_work(sdfg_json: Any, assumptions: str):
    if not work_depth:
        return {
            'error': {
                'message': 'DaCe version does not support work depth analysis',
                'details': 'Please update DaCe to a newer version',
            },
        }

    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    try:
        work_map = {}
        work_depth.analyze_sdfg(
            sdfg, work_map, work_depth.get_tasklet_work, assumptions.split(),
            False
        )
        for k, v, in work_map.items():
            work_map[k] = str(sp.simplify(v[0]))  # only take work
        return {
            'arithOpsMap': work_map,
        }
    except Exception as e:
        return {
            'error': {
                'message': 'Failed to analyze work',
                'details': get_exception_message(e),
            },
        }


def get_depth(sdfg_json: Any, assumptions: str):
    if not work_depth:
        return {
            'error': {
                'message': 'DaCe version does not support work depth analysis',
                'details': 'Please update DaCe to a newer version',
            },
        }

    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    try:
        depth_map = {}
        work_depth.analyze_sdfg(
            sdfg, depth_map, work_depth.get_tasklet_work_depth,
            assumptions.split(), False
        )
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


def get_avg_parallelism(sdfg_json: Any, assumptions: str):
    if not work_depth:
        return {
            'error': {
                'message': 'DaCe version does not support work depth analysis',
                'details': 'Please update DaCe to a newer version',
            },
        }

    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    try:
        avg_parallelism_map = {}
        work_depth.analyze_sdfg(
            sdfg, avg_parallelism_map, work_depth.get_tasklet_avg_par,
            assumptions.split(), False
        )
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
