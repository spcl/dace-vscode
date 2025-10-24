# Copyright 2020-2025 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

try:
    from dace.sdfg.performance_evaluation.operational_intensity import (
        analyze_sdfg_op_in
    )
except ModuleNotFoundError:
    analyze_sdfg_op_in = None

from dace_vscode.utils import load_sdfg_from_json, get_exception_message

def get_operational_intensity(sdfg_json, cache_params, assumptions):
    if not analyze_sdfg_op_in:
        return {
            'error': {
                'message': 'DaCe version does not support operational ' +
                    'intensity analysis',
                'details': 'Please update DaCe to a newer version',
            },
        }

    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']
    
    try:
        op_in_map = {}
        assumptions_dict = {
            x.split('==')[0] : int(x.split('==')[1])
            for x in assumptions.split()
        }
        print(cache_params)
        C = int(cache_params.split()[0])
        L = int(cache_params.split()[1])
        analyze_sdfg_op_in(
            sdfg, op_in_map, C, L, assumptions_dict, stringify=True
        )
        return {
            'opInMap': op_in_map,
        }
    except Exception as e:
        return {
            'error': {
                'message': 'Failed to analyze operational intensity',
                'details': get_exception_message(e),
            },
        }
