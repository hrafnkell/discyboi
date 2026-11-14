# ------------------------------------------------------------------ nets + footprints
import re as _re, subprocess as _sp
_SCRATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
_sp.run(['kicad-cli', 'sch', 'export', 'netlist', '--format', 'kicadsexpr', '-o', os.path.join(_SCRATCH, 'net.net'),
         os.path.join(OUT, f'{P}.kicad_sch')], check=True, capture_output=True)
_t = _re.sub(r'\s+', ' ', open(os.path.join(_SCRATCH, 'net.net')).read()); _t = _t[_t.find('(nets'):]
SCHNET = {}
for _m in _re.finditer(r'\(net \(code "\d+"\) \(name "([^"]*)"', _t):
    _e = _t.find('(net (code', _m.end()); _b = _t[_m.start():_e if _e > 0 else len(_t)]
    for _r, _p in _re.findall(r'\(node \(ref "([^"]+)"\) \(pin "([^"]+)"', _b):
        SCHNET[(_r, _p)] = _m.group(1)
NETS = {}
def net(name):
    if name not in NETS:
        n = pcbnew.NETINFO_ITEM(board, name); board.Add(n); NETS[name] = n
    return NETS[name]

def sym_uuid(ref): return str(uuid.uuid5(uuid.NAMESPACE_DNS, 'discyboi4.sym.' + ref))

FPS = {}
for p in PARTS:
    lib, name = p['fp'].split(':')
    fp = pcbnew.FootprintLoad((OUT + '/' if lib == P else FPLIB) + lib + '.pretty', name)
    fp.SetFPID(pcbnew.LIB_ID(lib, name))
    fp.SetReference(p['ref']); fp.SetValue(p['value'])
    x, y, rot = PLACE[p['ref']]
    board.Add(fp)
    fp.SetPosition(V(x, y)); fp.SetOrientationDegrees(rot)
    if p.get('side') == 'bottom':
        fp.SetLayerAndFlip(pcbnew.B_Cu)
    fp.SetPath(pcbnew.KIID_PATH('/' + sym_uuid(p['ref'])))
    fp.SetSheetname('/'); fp.SetSheetfile(f'{P}.kicad_sch')
    if p.get('mpn'):
        fp.SetField('MPN', p['mpn'])
    if p.get('lcsc'):
        fp.SetField('LCSC', p['lcsc'])
    if p.get('mfr'):
        fp.SetField('Manufacturer', p['mfr'])
    for _f in fp.GetFields():
        if _f.GetName() not in ('Reference',):
            _f.SetVisible(False)
    if not p.get('in_bom', True):
        fp.SetExcludedFromBOM(True)
        fp.SetExcludedFromPosFiles(True)
    if p.get('dnp'):
        fp.SetDNP(True)
    for pad in fp.Pads():
        n = SCHNET.get((p['ref'], pad.GetNumber()))
        if n:
            assert n == p['pins'].get(pad.GetNumber()) or n.startswith('unconnected-'), (p['ref'], pad.GetNumber(), n)
            pad.SetNet(net(n))
    # small silkscreen refs
    r = fp.Reference(); r.SetTextSize(pcbnew.VECTOR2I(mm(0.6), mm(0.6))); r.SetTextThickness(mm(0.1))
    r.SetVisible(False)
    FPS[p['ref']] = fp

ORIENT_TO = ORIENT_TO_V2
def _pp(ref, num):
    for pd in FPS[ref].Pads():
        if pd.GetNumber() == num:
            v = pd.GetPosition(); return (v.x / 1e6 - OX, v.y / 1e6 - OY)
for ref, (pn, (tr_, tp)) in ORIENT_TO.items():
    base = PLACE[ref][2] % 180
    best = None
    for rot in (base, base + 180):
        FPS[ref].SetOrientationDegrees(rot)
        a = _pp(ref, pn); b = _pp(tr_, tp)
        d = math.hypot(a[0] - b[0], a[1] - b[1])
        if best is None or d < best[0]: best = (d, rot)
    FPS[ref].SetOrientationDegrees(best[1])

def pad(ref, num):
    for pd in FPS[ref].Pads():
        if pd.GetNumber() == num:
            return pd
    raise KeyError((ref, num))

def ppos(ref, num):
    v = pad(ref, num).GetPosition(); return (v.x / 1e6 - OX, v.y / 1e6 - OY)

