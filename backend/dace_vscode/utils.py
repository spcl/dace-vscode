# Copyright 2020-2024 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

import sys
import traceback

from dace import SDFG, serialize

UUID_SEPARATOR = '/'


def get_exception_message(exception):
    return '%s: %s' % (type(exception).__name__, exception)


def ids_to_string(cfg_id, state_id=-1, node_id=-1, edge_id=-1):
    return (str(cfg_id) + UUID_SEPARATOR + str(state_id) + UUID_SEPARATOR +
            str(node_id) + UUID_SEPARATOR + str(edge_id))


def sdfg_find_state_from_element(sdfg, element):
    if hasattr(sdfg, 'cfg_list'):
        graph = sdfg.cfg_list[element['cfgId']]
    else:
        graph = sdfg.sdfg_list[element['cfgId']]

    if element['id'] >= 0:
        return graph.nodes()[element['id']]
    else:
        return None


def sdfg_find_node_from_element(sdfg, element):
    if hasattr(sdfg, 'cfg_list'):
        graph = sdfg.cfg_list[element['cfgId']]
    else:
        graph = sdfg.sdfg_list[element['cfgId']]

    if element['stateId'] >= 0:
        state = graph.nodes()[element['stateId']]
        node = state.nodes()[element['id']]
        node.state = state
        return node
    else:
        node = graph.nodes()[element['id']]
        node.state = None
        return node


def load_sdfg_from_file(path):
    try:
        sdfg = SDFG.from_file(path)
        error = None
    except Exception as e:
        print(traceback.format_exc(), file=sys.stderr)
        sys.stderr.flush()
        error = {
            'error': {
                'message': 'Failed to load the provided SDFG file path',
                'details': get_exception_message(e),
            },
        }
        sdfg = None
    return {
        'error': error,
        'sdfg': sdfg,
    }


def load_sdfg_from_json(json):
    if 'error' in json:
        message = ''
        if ('message' in json['error']):
            message = json['error']['message']
        error = {
            'error': {
                'message': 'Invalid SDFG provided',
                'details': message,
            }
        }
        sdfg = None
    else:
        try:
            sdfg = SDFG.from_json(json)
            error = None
        except Exception as e:
            print(traceback.format_exc(), file=sys.stderr)
            sys.stderr.flush()
            error = {
                'error': {
                    'message': 'Failed to parse the provided SDFG',
                    'details': get_exception_message(e),
                },
            }
            sdfg = None
    return {
        'error': error,
        'sdfg': sdfg,
    }


def disable_save_metadata():
    old_meta = False
    if hasattr(serialize, 'JSON_STORE_METADATA'):
        old_meta = serialize.JSON_STORE_METADATA
        serialize.JSON_STORE_METADATA = False
    return old_meta


def restore_save_metadata(old_meta):
    if hasattr(serialize, 'JSON_STORE_METADATA'):
        serialize.JSON_STORE_METADATA = old_meta
