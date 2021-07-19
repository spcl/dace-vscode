# Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

from dace import (
    serialize, nodes, SDFG, SDFGState, InterstateEdge, Memlet, dtypes
)
from dace_vscode.utils import (
    load_sdfg_from_json,
    find_graph_element_by_uuid,
    get_uuid,
    disable_save_metadata,
    restore_save_metadata,
)
import pydoc


def remove_sdfg_elements(sdfg_json, uuids):
    from dace.sdfg.graph import Edge

    old_meta = disable_save_metadata()

    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    elements = []
    for uuid in uuids:
        elements.append(find_graph_element_by_uuid(sdfg, uuid))

    for element_ret in elements:
        element = element_ret['element']
        parent = element_ret['parent']

        if parent is not None and element is not None:
            if isinstance(element, Edge):
                parent.remove_edge(element)
            else:
                parent.remove_node(element)
        else:
            return {
                'error': {
                    'message': 'Failed to delete element',
                    'details': 'Element or parent not found',
                },
            }

    new_sdfg = sdfg.to_json()
    restore_save_metadata(old_meta)

    return {
        'sdfg': new_sdfg,
    }


def insert_sdfg_element(sdfg_str, type, parent_uuid, edge_a_uuid):
    sdfg_answer = load_sdfg_from_json(sdfg_str)
    sdfg = sdfg_answer['sdfg']
    uuid = 'error'
    ret = find_graph_element_by_uuid(sdfg, parent_uuid)
    parent = ret['element']

    libname = None
    if type is not None and isinstance(type, str):
        split_type = type.split('|')
        if len(split_type) == 2:
            type = split_type[0]
            libname = split_type[1]

    if type == 'SDFGState':
        if parent is None:
            parent = sdfg
        elif isinstance(parent, nodes.NestedSDFG):
            parent = parent.sdfg
        state = parent.add_state()
        uuid = [get_uuid(state)]
    elif type == 'AccessNode':
        arrays = list(parent.parent.arrays.keys())
        if len(arrays) == 0:
            parent.parent.add_array('tmp', [1], dtype=dtypes.float64)
            arrays = list(parent.parent.arrays.keys())
        node = parent.add_access(arrays[0])
        uuid = [get_uuid(node, parent)]
    elif type == 'Map':
        map_entry, map_exit = parent.add_map('map', dict(i='0:1'))
        uuid = [get_uuid(map_entry, parent), get_uuid(map_exit, parent)]
    elif type == 'Consume':
        consume_entry, consume_exit = parent.add_consume('consume', ('i', '1'))
        uuid = [get_uuid(consume_entry, parent), get_uuid(consume_exit, parent)]
    elif type == 'Tasklet':
        tasklet = parent.add_tasklet(
            name='placeholder',
            inputs={'in'},
            outputs={'out'},
            code='')
        uuid = [get_uuid(tasklet, parent)]
    elif type == 'NestedSDFG':
        sub_sdfg = SDFG('nested_sdfg')
        sub_sdfg.add_array('in', [1], dtypes.float32)
        sub_sdfg.add_array('out', [1], dtypes.float32)
        
        nsdfg = parent.add_nested_sdfg(sub_sdfg, sdfg, {'in'}, {'out'})
        uuid = [get_uuid(nsdfg, parent)]
    elif type == 'LibraryNode':
        if libname is None:
            return {
                'error': {
                    'message': 'Failed to add library node',
                    'details': 'Must provide a valid library node type',
                },
            }
        libnode_class = pydoc.locate(libname)
        libnode = libnode_class()
        parent.add_node(libnode)
        uuid = [get_uuid(libnode, parent)]
    elif type == 'Edge':
        edge_start_ret = find_graph_element_by_uuid(sdfg, edge_a_uuid)
        edge_start = edge_start_ret['element']
        edge_parent = edge_start_ret['parent']
        if edge_start is not None:
            if edge_parent is None:
                edge_parent = sdfg

            if isinstance(edge_parent, SDFGState):
                if not (isinstance(edge_start, nodes.Node) and
                        isinstance(parent, nodes.Node)):
                    return {
                        'error': {
                            'message': 'Failed to add edge',
                            'details': 'Must connect two nodes or two states',
                        },
                    }
                memlet = Memlet()
                edge_parent.add_edge(edge_start, None, parent, None, memlet)
            elif isinstance(edge_parent, SDFG):
                if not (isinstance(edge_start, SDFGState) and
                        isinstance(parent, SDFGState)):
                    return {
                        'error': {
                            'message': 'Failed to add edge',
                            'details': 'Must connect two nodes or two states',
                        },
                    }
                isedge = InterstateEdge()
                edge_parent.add_edge(edge_start, parent, isedge)
            uuid = ['NONE']
        else:
            raise ValueError('No edge starting point provided')

    old_meta = disable_save_metadata()
    new_sdfg_str = sdfg.to_json()
    restore_save_metadata(old_meta)

    return {
        'sdfg': new_sdfg_str,
        'uuid': uuid,
    }
