# Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

import aenum
from argparse import ArgumentParser
import ast, astunparse
import dace
from dace.sdfg import propagation
from dace.symbolic import pystr_to_symbolic
from dace.libraries.blas import MatMul, Transpose
from dace.libraries.standard import Reduce
import inspect
import sympy
import sys
import traceback


# Prepare a whitelist of DaCe enumeration types
enum_list = [
    typename
    for typename, dtype in inspect.getmembers(dace.dtypes, inspect.isclass)
    if issubclass(dtype, aenum.Enum)
]

def count_matmul(node, symbols, state):
    A_memlet = next(e for e in state.in_edges(node) if e.dst_conn == '_a')
    B_memlet = next(e for e in state.in_edges(node) if e.dst_conn == '_b')
    C_memlet = next(e for e in state.out_edges(node) if e.src_conn == '_c')
    result = 2  # Multiply, add
    # Batch
    if len(C_memlet.data.subset) == 3:
        result *= symeval(C_memlet.data.subset.size()[0], symbols)
    # M*N
    result *= symeval(C_memlet.data.subset.size()[-2], symbols)
    result *= symeval(C_memlet.data.subset.size()[-1], symbols)
    # K
    result *= symeval(A_memlet.data.subset.size()[-1], symbols)
    return result

def count_reduce(node, symbols, state):
    result = 0
    if node.wcr is not None:
        result += count_arithmetic_ops_code(node.wcr)
    in_memlet = None
    in_edges = state.in_edges(node)
    if in_edges is not None and len(in_edges) == 1:
        in_memlet = in_edges[0]
    if in_memlet is not None and in_memlet.data.volume is not None:
        result *= in_memlet.data.volume
    else:
        result = 0
    return result

bigo = sympy.Function('bigo')
UUID_SEPARATOR = '/'
PYFUNC_TO_ARITHMETICS = {
    'float': 0,
    'math.exp': 1,
    'math.tanh': 1,
    'math.sqrt': 1,
    'min': 0,
    'max': 0,
    'ceiling': 0,
    'floor': 0,
}
LIBNODES_TO_ARITHMETICS = {
    MatMul: count_matmul,
    Transpose: lambda *args: 0,
    Reduce: count_reduce,
}

class ArithmeticCounter(ast.NodeVisitor):
    def __init__(self):
        self.count = 0

    def visit_BinOp(self, node):
        if isinstance(node.op, ast.MatMult):
            raise NotImplementedError('MatMult op count requires shape '
                                      'inference')
        self.count += 1
        return self.generic_visit(node)

    def visit_UnaryOp(self, node):
        self.count += 1
        return self.generic_visit(node)

    def visit_Call(self, node):
        fname = astunparse.unparse(node.func)[:-1]
        if fname not in PYFUNC_TO_ARITHMETICS:
            print('WARNING: Unrecognized python function "%s"' % fname)
            return self.generic_visit(node)
        self.count += PYFUNC_TO_ARITHMETICS[fname]
        return self.generic_visit(node)

    def visit_AugAssign(self, node):
        return self.visit_BinOp(node)

    def visit_For(self, node):
        raise NotImplementedError

    def visit_While(self, node):
        raise NotImplementedError

def ids_to_string(sdfg_id, state_id = -1, node_id = -1, edge_id = -1):
    return (str(sdfg_id) + UUID_SEPARATOR + str(state_id) + UUID_SEPARATOR +
            str(node_id) + UUID_SEPARATOR + str(edge_id))

def get_uuid(element, state=None):
    if isinstance(element, dace.SDFG):
        return ids_to_string(element.sdfg_id)
    elif isinstance(element, dace.SDFGState):
        return ids_to_string(element.parent.sdfg_id,
                             element.parent.node_id(element))
    elif isinstance(element, dace.nodes.Node):
        return ids_to_string(state.parent.sdfg_id,
                             state.parent.node_id(state),
                             state.node_id(element))
    else:
        return ids_to_string(-1)

def symeval(val, symbols):
    first_replacement = {
        pystr_to_symbolic(k): pystr_to_symbolic('__REPLSYM_' + k)
        for k in symbols.keys()
    }
    second_replacement = {
        pystr_to_symbolic('__REPLSYM_' + k): v
        for k, v in symbols.items()
    }
    return val.subs(first_replacement).subs(second_replacement)

def evaluate_symbols(base, new):
    result = {}
    for k, v in new.items():
        result[k] = symeval(v, base)
    return result

def count_arithmetic_ops_code(code):
    ctr = ArithmeticCounter()
    if isinstance(code, (tuple, list)):
        for stmt in code:
            ctr.visit(stmt)
    elif isinstance(code, str):
        ctr.visit(ast.parse(code))
    else:
        ctr.visit(code)
    return ctr.count

def create_arith_ops_map_state(state, arith_map, symbols):
    scope_tree_root = state.scope_tree()[None]
    scope_dict = state.scope_children()

    def traverse(scope):
        repetitions = 1
        traversal_result = 0
        if scope.entry is not None:
            repetitions = scope.entry.map.range.num_elements()
        for node in scope_dict[scope.entry]:
            node_result = 0
            if isinstance(node, dace.nodes.NestedSDFG):
                nested_syms = {}
                nested_syms.update(symbols)
                nested_syms.update(
                    evaluate_symbols(symbols, node.symbol_mapping)
                )
                node_result += create_arith_ops_map(node.sdfg,
                                                    arith_map,
                                                    nested_syms)
            elif isinstance(node, dace.nodes.LibraryNode):
                node_result += LIBNODES_TO_ARITHMETICS[type(node)](node,
                                                                   symbols,
                                                                   state)
            elif isinstance(node, dace.nodes.Tasklet):
                if node.code.language == dace.dtypes.Language.CPP:
                    for oedge in state.out_edges(node):
                        node_result += bigo(oedge.data.num_accesses)
                else:
                    node_result += count_arithmetic_ops_code(node.code.code)
            elif isinstance(node, dace.nodes.MapEntry):
                map_scope = None
                for child_scope in scope.children:
                    if child_scope.entry == node:
                        map_scope = child_scope
                        break
                map_result = 0
                if map_scope is not None:
                    map_result = traverse(map_scope)
                node_result += map_result
            elif isinstance(node, dace.nodes.MapExit):
                # Don't do anything for map exists.
                pass
            elif isinstance(node, (dace.nodes.CodeNode, dace.nodes.AccessNode)):
                for oedge in state.out_edges(node):
                    if oedge.data.wcr is not None:
                        node_result += count_arithmetic_ops_code(oedge.data.wcr)

            arith_map[get_uuid(node, state)] = str(node_result)
            traversal_result += node_result
        return repetitions * traversal_result
    state_result = traverse(scope_tree_root)

    if state.executions is not None:
        if (state.dynamic_executions is not None and state.dynamic_executions
            and state.executions == 0):
            state_result = 0
        else:
            state_result *= state.executions

    arith_map[get_uuid(state)] = str(state_result)
    return state_result

def create_arith_ops_map(sdfg, arith_map, symbols):
    sdfg_ops = 0
    for state in sdfg.nodes():
        sdfg_ops += create_arith_ops_map_state(state, arith_map, symbols)
    arith_map[get_uuid(sdfg)] = str(sdfg_ops)

    # Replace any operations that math.js does not understand.
    for uuid in arith_map:
        arith_map[uuid] = arith_map[uuid].replace('**', '^')

    return sdfg_ops

def get_exception_message(exception):
    return '%s: %s' % (type(exception).__name__, exception)

def load_sdfg_from_file(path):
    # We lazy import SDFGs, not to break cyclic imports, but to avoid any large
    # delays when booting in daemon mode.
    from dace.sdfg import SDFG

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
    # We lazy import SDFGs, not to break cyclic imports, but to avoid any large
    # delays when booting in daemon mode.
    from dace.sdfg import SDFG

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

def expand_library_node(json_in):
    """
    Expand a specific library node in a given SDFG. If no specific library node
    is provided, expand all library nodes in the given SDFG.
    :param json_in:  The entire provided request JSON.
    """
    from dace import serialize
    old_meta = serialize.JSON_STORE_METADATA
    serialize.JSON_STORE_METADATA = False

    sdfg = None
    try:
        loaded = load_sdfg_from_json(json_in['sdfg'])
        if loaded['error'] is not None:
            return loaded['error']
        sdfg = loaded['sdfg']
    except KeyError:
        return {
            'error': {
                'message': 'Failed to expand library node',
                'details': 'No SDFG provided',
            },
        }

    try:
        sdfg_id, state_id, node_id = json_in['nodeid']
    except KeyError:
        sdfg_id, state_id, node_id = None, None, None

    if sdfg_id is None:
        sdfg.expand_library_nodes()
    else:
        context_sdfg = sdfg.sdfg_list[sdfg_id]
        state = context_sdfg.node(state_id)
        node = state.node(node_id)
        if isinstance(node, dace.nodes.LibraryNode):
            node.expand(context_sdfg, state)
        else:
            return {
                'error': {
                    'message': 'Failed to expand library node',
                    'details': 'The provided node is not a valid library node',
                },
            }

    new_sdfg = sdfg.to_json()
    serialize.JSON_STORE_METADATA = old_meta
    return {
        'sdfg': new_sdfg,
    }

def reapply_history_until(sdfg_json, index):
    """
    Rewind a given SDFG back to a specific point in its history by reapplying
    all transformations until a given index in its history to its original
    state.
    :param sdfg_json:  The SDFG to rewind.
    :param index:      Index of the last history item to apply.
    """
    from dace import serialize
    old_meta = serialize.JSON_STORE_METADATA
    serialize.JSON_STORE_METADATA = False

    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    original_sdfg = sdfg.orig_sdfg
    history = sdfg.transformation_hist

    for i in range(index + 1):
        transformation = history[i]
        try:
            if isinstance(transformation, dace.transformation.transformation.SubgraphTransformation):
                transformation.apply(
                    original_sdfg.sdfg_list[transformation.sdfg_id]
                )
            else:
                transformation.apply_pattern(
                    original_sdfg.sdfg_list[transformation.sdfg_id]
                )
        except Exception as e:
            print(traceback.format_exc(), file=sys.stderr)
            sys.stderr.flush()
            return {
                'error': {
                    'message': 'Failed to play back the transformation history',
                    'details': get_exception_message(e),
                },
            }

    new_sdfg = original_sdfg.to_json()
    serialize.JSON_STORE_METADATA = old_meta
    return {
        'sdfg': new_sdfg,
    }

def apply_transformation(sdfg_json, transformation_json):
    # We lazy import DaCe, not to break cyclic imports, but to avoid any large
    # delays when booting in daemon mode.
    from dace import serialize
    old_meta = serialize.JSON_STORE_METADATA
    serialize.JSON_STORE_METADATA = False

    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    try:
        transformation = serialize.from_json(transformation_json)
    except Exception as e:
        print(traceback.format_exc(), file=sys.stderr)
        sys.stderr.flush()
        return {
            'error': {
                'message': 'Failed to parse the applied transformation',
                'details': get_exception_message(e),
            },
        }
    try:
        target_sdfg = sdfg.sdfg_list[transformation.sdfg_id]
        if isinstance(transformation, dace.transformation.transformation.SubgraphTransformation):
            sdfg.append_transformation(transformation)
            transformation.apply(target_sdfg)
        else:
            transformation.apply_pattern(target_sdfg)
    except Exception as e:
        print(traceback.format_exc(), file=sys.stderr)
        sys.stderr.flush()
        return {
            'error': {
                'message': 'Failed to apply the transformation to the SDFG',
                'details': get_exception_message(e),
            },
        }

    new_sdfg = sdfg.to_json()
    serialize.JSON_STORE_METADATA = old_meta
    return {
        'sdfg': new_sdfg,
    }

def sdfg_find_state(sdfg, element):
    graph = sdfg.sdfg_list[element['sdfg_id']]
    if element['id'] >= 0:
        return graph.nodes()[element['id']]
    else:
        return None

def sdfg_find_node(sdfg, element):
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

def get_arith_ops(sdfg_json):
    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    propagation.propagate_memlets_sdfg(sdfg)

    arith_map = {}
    create_arith_ops_map(sdfg, arith_map, {})
    return {
        'arith_ops_map': arith_map,
    }

def get_transformations(sdfg_json, selected_elements):
    # We lazy import DaCe, not to break cyclic imports, but to avoid any large
    # delays when booting in daemon mode.
    from dace.transformation.optimizer import SDFGOptimizer
    from dace import serialize

    old_meta = serialize.JSON_STORE_METADATA
    serialize.JSON_STORE_METADATA = False
    from dace.sdfg.graph import SubgraphView
    from dace.transformation.transformation import SubgraphTransformation

    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    optimizer = SDFGOptimizer(sdfg)
    matches = optimizer.get_pattern_matches()

    transformations = []
    docstrings = {}
    for transformation in matches:
        transformations.append(transformation.to_json())
        docstrings[type(transformation).__name__] = transformation.__doc__

    selected_states = [
        sdfg_find_state(sdfg, n)
        for n in selected_elements if n['type'] == 'state'
    ]
    selected_nodes = [
        sdfg_find_node(sdfg, n)
        for n in selected_elements if n['type'] == 'node'
    ]
    subgraph = None
    if len(selected_states) > 0:
       subgraph = SubgraphView(sdfg, selected_states)
    else:
        violated = False
        state = None
        for node in selected_nodes:
            if state is None:
                state = node.state
            elif state != node.state:
                violated = True
                break
        if not violated and state is not None:
            subgraph = SubgraphView(state, selected_nodes)

    if subgraph is not None:
        for xform in SubgraphTransformation.extensions():
            xform_obj = xform(subgraph)
            if xform_obj.can_be_applied(sdfg, subgraph):
                transformations.append(xform_obj.to_json())
                docstrings[xform.__name__] = xform_obj.__doc__

    serialize.JSON_STORE_METADATA = old_meta
    return {
        'transformations': transformations,
        'docstrings': docstrings,
    }

def get_enum(name):
    if name not in enum_list:
        return {
            'error': {
                'message': 'Failed to get Enum',
                'details': 'Enum type "' + str(name) + '" is not in whitelist',
            },
        }
    return {'enum': [str(e).split('.')[-1] for e in getattr(dace.dtypes, name)]}


def get_property_metdata():
    """ Generate a dictionary of class properties and their metadata.
        This iterates over all classes registered as serializable in DaCe's
        serialization module, checks whether there are properties present
        (true for any class registered via the @make.properties decorator), and
        then assembels their metadata to a dictionary.
    """
    # Lazy import to cut down on module load time.
    from dace.sdfg.nodes import full_class_path

    # In order to get all transformation metadata the @make.properties
    # annotation for each transformation needs to have run, so the
    # transformations are registered in `dace.serialize._DACE_SERIALIZE_TYPES`.
    # The simplest way to achieve this is by simply getting all pattern matches
    # of a dummy SDFG. Since this code should only be run once per SDFG editor,
    # this doesn't add any continuous overhead like it would if we were to
    # send transformation metadata along with `get_transformations`.
    from dace.transformation import optimizer
    _ = optimizer.Optimizer(dace.SDFG('dummy')).get_pattern_matches()

    meta_dict = {}
    meta_dict['__reverse_type_lookup__'] = {}
    for typename in dace.serialize._DACE_SERIALIZE_TYPES:
        t = dace.serialize._DACE_SERIALIZE_TYPES[typename]
        if hasattr(t, '__properties__'):
            meta_key = typename
            if (issubclass(t, dace.sdfg.nodes.LibraryNode)
                and not t == dace.sdfg.nodes.LibraryNode):
                meta_key = full_class_path(t)

            meta_dict[meta_key] = {}
            libnode_implementations = None
            if hasattr(t, 'implementations'):
                libnode_implementations = list(t.implementations.keys())
            for propname, prop in t.__properties__.items():
                meta_dict[meta_key][propname] = prop.meta_to_json(prop)

                if hasattr(prop, 'key_type') and hasattr(prop, 'value_type'):
                    # For dictionary properties, add their key and value types.
                    meta_dict[meta_key][propname][
                        'key_type'
                    ] = prop.key_type.__name__
                    meta_dict[meta_key][propname][
                        'value_type'
                    ] = prop.value_type.__name__
                elif hasattr(prop, 'element_type'):
                    meta_dict[meta_key][propname][
                        'element_type'
                    ] = prop.element_type.__name__

                if prop.choices is not None:
                    # If there are specific choices for this property (i.e. this
                    # property is an enum), list those as metadata as well.
                    if inspect.isclass(prop.choices):
                        if issubclass(prop.choices, aenum.Enum):
                            choices = []
                            for choice in prop.choices:
                                choice_short = str(choice).split('.')[-1]
                                if choice_short != 'Undefined':
                                    choices.append(choice_short)
                            meta_dict[meta_key][propname]['choices'] = choices
                elif (propname == 'implementation'
                    and libnode_implementations is not None):
                    # For implementation properties, add all library
                    # implementations as choices.
                    meta_dict[meta_key][propname][
                        'choices'
                    ] = libnode_implementations

                # Create a reverse lookup method for each meta type. This allows
                # us to get meta information about things other than properties
                # contained in some SDFG properties (types, CodeBlocks, etc.).
                if meta_dict[meta_key][propname]['metatype']:
                    meta_type = meta_dict[meta_key][propname]['metatype']
                    if not meta_type in meta_dict['__reverse_type_lookup__']:
                        meta_dict['__reverse_type_lookup__'][
                            meta_type
                        ] = meta_dict[meta_key][propname]

    # Save a lookup for enum values not present yet.
    for enum_name in enum_list:
        if not enum_name in meta_dict['__reverse_type_lookup__']:
            choices = []
            for choice in getattr(dace.dtypes, enum_name):
                choice_short = str(choice).split('.')[-1]
                if choice_short != 'Undefined':
                    choices.append(choice_short)
            meta_dict['__reverse_type_lookup__'][enum_name] = {
                'category': 'General',
                'metatype': enum_name,
                'choices': choices,
            }

    return {
        'meta_dict': meta_dict,
    }


def _sdfg_remove_instrumentations(sdfg: dace.sdfg.SDFG):
    sdfg.instrument = dace.dtypes.InstrumentationType.No_Instrumentation
    for state in sdfg.nodes():
        state.instrument = dace.dtypes.InstrumentationType.No_Instrumentation
        for node in state.nodes():
            node.instrument = dace.dtypes.InstrumentationType.No_Instrumentation
            if isinstance(node, dace.sdfg.nodes.NestedSDFG):
                _sdfg_remove_instrumentations(node.sdfg)

def compile_sdfg(path, suppress_instrumentation=False):
    # We lazy import DaCe, not to break cyclic imports, but to avoid any large
    # delays when booting in daemon mode.
    from dace import serialize
    from dace.codegen.compiled_sdfg import CompiledSDFG;
    old_meta = serialize.JSON_STORE_METADATA
    serialize.JSON_STORE_METADATA = False

    loaded = load_sdfg_from_file(path)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    if suppress_instrumentation:
        _sdfg_remove_instrumentations(sdfg)

    compiled_sdfg: CompiledSDFG = sdfg.compile()

    serialize.JSON_STORE_METADATA = old_meta
    return {
        'filename': compiled_sdfg.filename,
    }

def run_daemon(port):
    from logging.config import dictConfig
    from flask import Flask, request

    # Move Flask's logging over to stdout, because stderr is used for error
    # reporting. This was taken from
    # https://stackoverflow.com/questions/56905756
    dictConfig({
        'version': 1,
        'formatters': {'default': {
            'format': '[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
        }},
        'handlers': {'wsgi': {
            'class': 'logging.StreamHandler',
            'stream': 'ext://sys.stdout',
            'formatter': 'default',
        }},
        'root': {
            'level': 'INFO',
            'handlers': ['wsgi'],
        }
    })

    daemon = Flask('DaCeInterface')
    daemon.config['DEBUG'] = False

    @daemon.route('/', methods=['GET'])
    def _root():
        return 'success!'

    @daemon.route('/transformations', methods=['POST'])
    def _get_transformations():
        request_json = request.get_json()
        return get_transformations(request_json['sdfg'],
                                   request_json['selected_elements'])

    @daemon.route('/apply_transformation', methods=['POST'])
    def _apply_transformation():
        request_json = request.get_json()
        return apply_transformation(request_json['sdfg'],
                                    request_json['transformation'])

    @daemon.route('/expand_library_node', methods=['POST'])
    def _expand_library_node():
        request_json = request.get_json()
        return expand_library_node(request_json)

    @daemon.route('/reapply_history_until', methods=['POST'])
    def _reapply_history_until():
        request_json = request.get_json()
        return reapply_history_until(request_json['sdfg'],
                                     request_json['index'])

    @daemon.route('/get_arith_ops', methods=['POST'])
    def _get_arith_ops():
        request_json = request.get_json()
        return get_arith_ops(request_json['sdfg'])

    @daemon.route('/get_enum/<string:name>', methods=['GET'])
    def _get_enum(name):
        return get_enum(name)

    @daemon.route('/compile_sdfg_from_file', methods=['POST'])
    def _compile_sdfg_from_file():
        request_json = request.get_json()
        return compile_sdfg(
            request_json['path'],
            request_json['suppress_instrumentation']
        )

    @daemon.route('/get_metadata', methods=['GET'])
    def _get_metadata():
        return get_property_metdata()

    daemon.run(port=port)

if __name__ == '__main__':
    parser = ArgumentParser()

    '''
    parser.add_argument('-d',
                        '--daemon',
                        action='store_true',
                        help='Run as a daemon')
                        '''

    parser.add_argument('-p',
                        '--port',
                        action='store',
                        default=5000,
                        type=int,
                        help='The port to listen on')

    parser.add_argument('-t',
                        '--transformations',
                        action='store_true',
                        help='Get applicable transformations for an SDFG')

    args = parser.parse_args()

    if (args.transformations):
        get_transformations(None)
    else:
        run_daemon(args.port)
