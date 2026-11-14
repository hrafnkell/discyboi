#!/bin/bash
set -e
D=/home/keli/code/discyboi/v4; G="$(dirname "$(readlink -f "$0")")"; S="$G/.."
python3 $G/gen_fp.py $D; python3 $G/gen_sch.py $D; python3 $G/write_pro.py $D
$G/assemble.sh
ROUTER=${ROUTER:-freerouting} python3 $G/build_pcb.py $D 2>&1 | grep -v property.h | tail -6
rm -f "$D/~discyboi.kicad_pro.lck"
kicad-cli sch erc --severity-all -o $S/erc2.rpt $D/discyboi.kicad_sch | tail -1; grep "ERC messages" $S/erc2.rpt
kicad-cli pcb drc --schematic-parity --severity-all -o $S/drc2.rpt $D/discyboi.kicad_pcb | tail -3
grep -E "^\[" $S/drc2.rpt | sed 's/(.*//' | sort | uniq -c | sort -rn
