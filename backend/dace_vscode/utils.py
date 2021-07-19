# Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

from dace import SDFG, SDFGState, nodes, serialize
import sys
import traceback


UUID_SEPARATOR = '/'


def get_exception_message(exception):
    return '%s: %s' % (type(exception).__name__, exception)


def ids_to_string(sdfg_id, state_id=-1, node_id=-1, edge_id=-1):
    return (str(sdfg_id) + UUID_SEPARATOR + str(state_id) + UUID_SEPARATOR +
            str(node_id) + UUID_SEPARATOR + str(edge_id))


def get_uuid(element, state=None):
    if isinstance(element, SDFG):
        return ids_to_string(element.sdfg_id)
    elif isinstance(element, SDFGState):
        return ids_to_string(element.parent.sdfg_id,
                             element.parent.node_id(element))
    elif isinstance(element, nodes.Node):
        return ids_to_string(state.parent.sdfg_id, state.parent.node_id(state),
                             state.node_id(element))
    else:
        return ids_to_string(-1)


def recursively_find_graph(graph, graph_id, ns_node = None):
    if graph.sdfg_id == graph_id:
        return {
            'graph': graph,
            'node': ns_node,
        }

    res = {
        'graph': None,
        'node': None,
    }

    for state in graph.nodes():
        for node in state.nodes():
            if isinstance(node, nodes.NestedSDFG):
                graph_result = recursively_find_graph(
                    node.sdfg, graph_id, node
                )
                if graph_result != None:
                    return graph_result

    return res


def find_graph_element_by_uuid(sdfg, uuid):
    uuid_split = uuid.split(UUID_SEPARATOR)

    graph_id = int(uuid_split[0])
    state_id = int(uuid_split[1])
    node_id = int(uuid_split[2])
    edge_id = int(uuid_split[3])

    ret = {
        'parent': None,
        'element': None,
    }

    graph = sdfg
    if graph_id > 0:
        found_graph = recursively_find_graph(graph, graph_id)
        graph = found_graph['graph']
        ret = {
            'parent': graph,
            'element': found_graph['node'],
        }

    state = None
    if state_id != -1 and graph is not None:
        state = graph.node(state_id)
        ret = {
            'parent': graph,
            'element': state,
        }

    if node_id != -1 and state is not None:
        ret = {
            'parent': state,
            'element': state.node(node_id),
        }
    elif edge_id != -1 and state is not None:
        ret = {
            'parent': state,
            'element': state.edges()[edge_id],
        }
    elif edge_id != -1 and state is None:
        ret = {
            'parent': graph,
            'element': graph.edges()[edge_id],
        }

    return ret


def sdfg_find_state_from_element(sdfg, element):
    graph = sdfg.sdfg_list[element['sdfg_id']]
    if element['id'] >= 0:
        return graph.nodes()[element['id']]
    else:
        return None


def sdfg_find_node_from_element(sdfg, element):
    graph = sdfg.sdfg_list[element['sdfg_id']]
    if element['state_id'] >= 0:
        state = graph.nodes()[element['state_id']]
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
