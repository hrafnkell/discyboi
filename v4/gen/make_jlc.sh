#!/bin/bash
set -e
D=/home/keli/code/discyboi/v4; S="$(dirname "$(readlink -f "$0")")/.."
cd $D && rm -rf jlcpcb && mkdir -p jlcpcb/gerbers
kicad-cli pcb export gerbers --layers F.Cu,In1.Cu,In2.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts -o jlcpcb/gerbers/ discyboi.kicad_pcb >/dev/null
kicad-cli pcb export drill --format excellon --excellon-separate-th -o jlcpcb/gerbers/ discyboi.kicad_pcb >/dev/null
kicad-cli pcb export pos --format csv --units mm --side front --exclude-dnp -o $S/pos.csv discyboi.kicad_pcb >/dev/null
kicad-cli pcb export pos --format csv --units mm --side back --exclude-dnp -o $S/pos_back.csv discyboi.kicad_pcb >/dev/null
kicad-cli sch export bom --fields 'Reference,Value,Footprint,LCSC,MPN,Manufacturer,${QUANTITY}' --labels 'Ref,Value,Footprint,LCSC,MPN,Manufacturer,Qty' --group-by 'Value,Footprint,LCSC' --exclude-dnp -o $S/bom.csv discyboi.kicad_sch >/dev/null
python3 - "$S" <<'PY'
import csv, sys
S = sys.argv[1]
pos = list(csv.DictReader(open(S + '/pos.csv')))
with open('jlcpcb/discyboi-CPL.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['Designator', 'Mid X', 'Mid Y', 'Layer', 'Rotation'])
    for r in pos: w.writerow([r['Ref'], r['PosX'] + 'mm', r['PosY'] + 'mm', 'Top' if r['Side'] == 'top' else 'Bottom', r['Rot']])
def expand(s):
    out = []
    for p in s.split(','):
        if '-' in p:
            a, b = p.split('-'); pre = a.rstrip('0123456789'); out += [pre + str(i) for i in range(int(a[len(pre):]), int(b[len(pre):]) + 1)]
        else: out.append(p)
    return out
bom = list(csv.DictReader(open(S + '/bom.csv')))
back = {r['Ref'] for r in csv.DictReader(open(S + '/pos_back.csv'))}   # hand-soldered: not in the JLC files
with open('jlcpcb/discyboi-BOM.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['Comment', 'Designator', 'Footprint', 'LCSC Part #'])
    for r in bom:
        refs = [x for x in expand(r['Ref']) if x not in back]
        if refs: w.writerow([r['Value'], ','.join(refs), r['Footprint'].split(':')[1], r['LCSC']])
# What a substitute must meet. Passives listed here are generic: the MPN is just one that fits.
# Anything not listed (module, sensors, LDO, clip) must be the exact part.
SPEC = {
    ('10u', '0402'): '10uF 0402 X5R, 6.3V or more',
    ('4.7u', '0402'): '4.7uF 0402 X5R, 6.3V or more',
    ('1u', '0402'): '1uF 0402 X5R, 6.3V or more',
    ('100n', '0402'): '100nF 0402 X5R/X7R, 6.3V or more',
    ('100u', '1206'): '100uF 1206 X5R, 6.3V or more (not 4V: keeps far less capacitance at 3V)',
    ('10M', '0402'): '10M 0402 1% (battery sense divider)',
    ('1k', '0402'): '1k 0402, any tolerance',
    ('100k', '0402'): '100k 0402, any tolerance',
    ('Green', '0603'): '0603 yellow-green AlInGaP LED, ~570nm, Vf ~2V (not InGaN 525nm green: too dim at 3V)',
}
def size(fp):
    for z in ('0402', '0603', '1206'):
        if '_' + z + '_' in fp: return z
with open('discyboi-mouser-BOM.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['Quantity', 'Manufacturer', 'Manufacturer Part Number', 'Reference Designators', 'Value', 'Footprint', 'Substitute'])
    for r in bom:
        assert r['MPN'], ('missing MPN', r)
        sp = SPEC.get((r['Value'], size(r['Footprint'])))
        w.writerow([len(expand(r['Ref'])), r['Manufacturer'], r['MPN'], ' '.join(expand(r['Ref'])), r['Value'], r['Footprint'].split(':')[1],
                    'Any equivalent: ' + sp if sp else 'Exact part'])
cpl = sorted(r['Ref'] for r in pos); bomrefs = sorted(x for r in bom for x in expand(r['Ref']) if x not in back)
print('bottom side (hand solder):', sorted(back))
print('CPL == BOM designators:', cpl == bomrefs, len(cpl))
PY
(cd jlcpcb/gerbers && zip -q -r ../discyboi-gerbers.zip .)
rm -f "$D/~discyboi.kicad_pro.lck"
