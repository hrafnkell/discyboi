#!/bin/bash
cd "$(dirname "$0")"; : > build_pcb.py
for f in _head.py _seg_fp.py _seg_helpers.py _zones.py _seg_router1.py _seg_mark.py _seg_router2.py _tail.py; do cat $f >> build_pcb.py; echo >> build_pcb.py; done
