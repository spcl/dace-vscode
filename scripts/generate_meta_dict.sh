#!/usr/bin/env bash

read -r -d '' PYCMD << EOPYCMD
from backend.run_dace import get_property_metadata;
import json;
metadata = get_property_metadata(force_regenerate=True);
f = open('src/utils/sdfg_meta_dict.json', 'w');
f.write(json.dumps(metadata['metaDict'], indent=2));
f.close();
EOPYCMD

echo 'Generating metadata dictionary...'
python -c "$PYCMD"
echo 'Generated'
