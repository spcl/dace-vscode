# Copyright 2020-2022 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

import ast
import astunparse
from dace.symbolic import pystr_to_symbolic
from dace.sdfg import propagation
from dace.libraries.blas import MatMul, Transpose
from dace.libraries.standard import Reduce
from dace import nodes, dtypes
import sympy

from dace_vscode.utils import get_uuid, load_sdfg_from_json


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
            if isinstance(node, nodes.NestedSDFG):
                nested_syms = {}
                nested_syms.update(symbols)
                nested_syms.update(
                    evaluate_symbols(symbols, node.symbol_mapping))
                node_result += create_arith_ops_map(node.sdfg, arith_map,
                                                    nested_syms)
            elif isinstance(node, nodes.LibraryNode):
                node_result += LIBNODES_TO_ARITHMETICS[type(node)](node,
                                                                   symbols,
                                                                   state)
            elif isinstance(node, nodes.Tasklet):
                if node.code.language == dtypes.Language.CPP:
                    for oedge in state.out_edges(node):
                        node_result += bigo(oedge.data.num_accesses)
                else:
                    node_result += count_arithmetic_ops_code(node.code.code)
            elif isinstance(node, nodes.MapEntry):
                map_scope = None
                for child_scope in scope.children:
                    if child_scope.entry == node:
                        map_scope = child_scope
                        break
                map_result = 0
                if map_scope is not None:
                    map_result = traverse(map_scope)
                node_result += map_result
            elif isinstance(node, nodes.MapExit):
                # Don't do anything for map exists.
                pass
            elif isinstance(node,
                            (nodes.CodeNode, nodes.AccessNode)):
                for oedge in state.out_edges(node):
                    if oedge.data.wcr is not None:
                        node_result += count_arithmetic_ops_code(
                            oedge.data.wcr)

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


def get_arith_ops(sdfg_json):
    loaded = load_sdfg_from_json(sdfg_json)
    if loaded['error'] is not None:
        return loaded['error']
    sdfg = loaded['sdfg']

    propagation.propagate_memlets_sdfg(sdfg)

    arith_map = {}
    create_arith_ops_map(sdfg, arith_map, {})
    return {
        'arithOpsMap': arith_map,
    }
