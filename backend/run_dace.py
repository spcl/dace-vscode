# Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
# All rights reserved.

#####################################################################
# Before importing anything, try to take the ".env" file into account
import os
import re
import sys
try:
    import dotenv
    import re
    import sys

    # First, load the environment
    dotenv.load_dotenv()
    # Then, gather values
    vals = dotenv.dotenv_values()
except (ModuleNotFoundError, ImportError):
    # Failsafe mode - try to load directly
    vals = {}
    if os.path.isfile('.env'):
        with open('.env', 'r') as fp:
            lines = fp.readlines()
            for line in lines:
                if '=' not in line:
                    continue
                pos = line.find('=')
                envvar = line[:pos]
                envval = line[pos + 1:]
                vals[envvar] = envval

            # First, load the environment
            os.environ.update(vals)

# Add any extra module paths from .env
if 'PYTHONPATH' in vals:
    paths = re.split(';|:', vals['PYTHONPATH'])
    sys.path.extend(paths)
#####################################################################

# Then, load the rest of the modules
import aenum
from argparse import ArgumentParser
import dace
import inspect
import sys

from dace_backend.utils import (
    load_sdfg_from_file,
)
from dace_backend.arith_ops import get_arith_ops
from dace_backend import transformations, editing


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
    meta_dict['__libs__'] = {}
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
                        'key_type'] = prop.key_type.__name__
                    meta_dict[meta_key][propname][
                        'value_type'] = prop.value_type.__name__
                elif hasattr(prop, 'element_type'):
                    meta_dict[meta_key][propname][
                        'element_type'] = prop.element_type.__name__

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
                        'choices'] = libnode_implementations

                # Create a reverse lookup method for each meta type. This allows
                # us to get meta information about things other than properties
                # contained in some SDFG properties (types, CodeBlocks, etc.).
                if meta_dict[meta_key][propname]['metatype']:
                    meta_type = meta_dict[meta_key][propname]['metatype']
                    if not meta_type in meta_dict['__reverse_type_lookup__']:
                        meta_dict['__reverse_type_lookup__'][
                            meta_type] = meta_dict[meta_key][propname]

            # For library nodes we want to make sure they are all easily
            # accessible under '__libs__', to be able to list them all out.
            if (issubclass(t, dace.sdfg.nodes.LibraryNode)
                and not t == dace.sdfg.nodes.LibraryNode):
                meta_dict['__libs__'][typename] = meta_key

    # Save a lookup for enum values not present yet.
    enum_list = [
        typename
        for typename, dtype in inspect.getmembers(dace.dtypes, inspect.isclass)
        if issubclass(dtype, aenum.Enum)
    ]
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
    from dace.codegen.compiled_sdfg import CompiledSDFG
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
        'formatters': {
            'default': {
                'format':
                '[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
            }
        },
        'handlers': {
            'wsgi': {
                'class': 'logging.StreamHandler',
                'stream': 'ext://sys.stdout',
                'formatter': 'default',
            }
        },
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
        return transformations.get_transformations(
            request_json['sdfg'], request_json['selected_elements']
        )

    @daemon.route('/apply_transformation', methods=['POST'])
    def _apply_transformation():
        request_json = request.get_json()
        return transformations.apply_transformation(
            request_json['sdfg'], request_json['transformation']
        )

    @daemon.route('/expand_library_node', methods=['POST'])
    def _expand_library_node():
        request_json = request.get_json()
        return transformations.expand_library_node(request_json)

    @daemon.route('/reapply_history_until', methods=['POST'])
    def _reapply_history_until():
        request_json = request.get_json()
        return transformations.reapply_history_until(
            request_json['sdfg'], request_json['index']
        )

    @daemon.route('/get_arith_ops', methods=['POST'])
    def _get_arith_ops():
        request_json = request.get_json()
        return get_arith_ops(request_json['sdfg'])

    @daemon.route('/compile_sdfg_from_file', methods=['POST'])
    def _compile_sdfg_from_file():
        request_json = request.get_json()
        return compile_sdfg(request_json['path'],
                            request_json['suppress_instrumentation'])

    @daemon.route('/insert_sdfg_element', methods=['POST'])
    def _insert_sdfg_element():
        request_json = request.get_json()
        return editing.insert_sdfg_element(
            request_json['sdfg'], request_json['type'], request_json['parent'],
            request_json['edge_a']
        )

    @daemon.route('/remove_sdfg_elements', methods=['POST'])
    def _remove_sdfg_elements():
        request_json = request.get_json()
        return editing.remove_sdfg_elements(
            request_json['sdfg'], request_json['uuids']
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
        transformations.get_transformations(None)
    else:
        run_daemon(args.port)
