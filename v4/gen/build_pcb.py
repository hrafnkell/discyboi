"""Build v4 discyboi.kicad_pcb: round 34 mm board, Fanstel BC15M module, sensors, CR2032 holder on the bottom.
Plane escapes are done by the in-house grid router, signals by Freerouting (fallback: grid router)."""
import heapq, json, math, os, subprocess, sys, uuid
import numpy as np
import pcbnew
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from design import PARTS, P

OUT = sys.argv[1]
SCRATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FPLIB = '/usr/share/kicad/footprints/'
FREEROUTING = os.path.expanduser('~/Downloads/freerouting-2.5.0-x86_64.AppImage')
OX, OY = 100.0, 100.0
D = 34.0                         # 31.5 mm CR2032 holder land pattern + edge clearance
BW, BH = D, D
R = D / 2
CX, CY = R, R                    # board centre in local coords
FLAT = CY - 10.2                 # straight edge; the BC15M antenna (3.6 mm) overhangs it
mm = pcbnew.FromMM
def V(x, y): return pcbnew.VECTOR2I(mm(float(OX + x)), mm(float(OY + y)))

CLR = 0.12
VIA_D, VIA_DRILL = 0.45, 0.2   # JLC: 0.4 mm vias need a paid 4-wire Kelvin test
W_SIG, W_PWR, W_BAT = 0.15, 0.25, 0.3
NET_W = {'VCHG': W_BAT, 'VBAT': W_BAT, '+3V0': W_PWR, 'GND': W_PWR}

PC = {  # placement relative to board centre (x right, y down), deg
    'U1': (0.0, -9.0, 0),            # module centre; its antenna/shield boundary (y=-1.2 local) sits on FLAT
    'C2': (4.1, -4.4, 90), 'C1': (5.2, -4.4, 90),
    'U5': (0.0, 0.5, 0), 'C10': (2.6, 1.6, 90), 'C11': (3.7, 1.6, 90), 'C12': (-1.4, 2.8, 0),
    'U3': (-9.0, 0.0, 0), 'C19': (-6.4, 1.1, 90), 'C21': (-5.3, 1.1, 90), 'C20': (-10.4, 2.3, 0),
    'R5': (-4.6, -2.6, 0), 'D1': (-4.6, -1.2, 0),
    'J2': (-11.5, -7.8, 0),          # guide holes must clear the cell on the bottom side
    'C18': (-2.2, 6.0, 90), 'R4': (-3.4, 6.0, 90), 'R3': (-4.6, 6.0, 90),
    'U2': (7.6, 1.8, 0), 'C16': (4.9, 2.0, 90), 'C17': (10.4, 1.8, 90),
    'U4': (6.9, 6.4, 0), 'C14': (4.2, 6.4, 90), 'C13': (9.5, 5.6, 90), 'R7': (9.5, 7.6, 90),
    'R8': (11.5, 1.8, 90), 'D2': (11.0, 5.2, 90), 'D3': (1.0, 7.6, 90),
    'R9': (5.4, -6.7, 0), 'R10': (5.4, -7.9, 0),
    # CR2032 holder on the bottom, cell centre 2.5 mm towards the bottom edge so the cell stays >2 mm
    # from the antenna edge (and partly balances the module's mass at the top)
    'BT1': (0.0, 2.5, 0), 'C22': (11.4, -0.9, 0),
    'TP1': (-5.0, 10.0, 0), 'TP2': (-1.7, 11.4, 0), 'TP3': (1.7, 11.4, 0), 'TP4': (5.0, 10.0, 0),
}
PLACE = {k: (x + CX, y + CY, r) for k, (x, y, r) in PC.items()}

ORIENT_TO_V2 = {
    'C2': ('1', ('U1', 'F6')), 'C1': ('1', ('U1', 'F6')), 'C10': ('1', ('U5', '8')), 'C11': ('1', ('U5', '8')),
    'C12': ('1', ('U5', '5')), 'C20': ('1', ('U3', '5')), 'C19': ('1', ('U3', '8')), 'C21': ('1', ('U3', '8')),
    'R5': ('1', ('U1', 'A5')), 'D1': ('2', ('R5', '2')), 'C18': ('1', ('U1', 'B6')), 'R4': ('1', ('U1', 'B6')),
    'R3': ('2', ('U1', 'B6')), 'C16': ('1', ('U2', '3')), 'C17': ('1', ('U2', '2')), 'C14': ('1', ('U4', '3')),
    'C13': ('1', ('U4', '4')), 'R7': ('1', ('U4', '5')), 'R8': ('1', ('U4', '4')), 'D2': ('1', ('U4', '1')),
    'D3': ('1', ('TP3', '1')), 'R9': ('2', ('U1', 'F4')), 'R10': ('1', ('U1', 'F4')),
}

board = pcbnew.NewBoard(os.path.join(OUT, f'{P}.kicad_pcb'))
board.SetCopperLayerCount(4)
ds = board.GetDesignSettings()
ds.m_MinClearance = mm(CLR); ds.m_TrackMinWidth = mm(0.1); ds.m_ViasMinSize = mm(0.35)
ds.m_MinThroughDrill = mm(0.2); ds.m_CopperEdgeClearance = mm(0.25)

# ------------------------------------------------------------------ outline: circle with a flat for the antenna
half = math.sqrt(R * R - (CY - FLAT) ** 2)
s = pcbnew.PCB_SHAPE(board); s.SetShape(pcbnew.SHAPE_T_SEGMENT)
s.SetStart(V(CX - half, FLAT)); s.SetEnd(V(CX + half, FLAT)); s.SetLayer(pcbnew.Edge_Cuts); s.SetWidth(mm(0.1)); board.Add(s)
s = pcbnew.PCB_SHAPE(board); s.SetShape(pcbnew.SHAPE_T_ARC)
s.SetArcGeometry(V(CX + half, FLAT), V(CX, CY + R), V(CX - half, FLAT)); s.SetLayer(pcbnew.Edge_Cuts); s.SetWidth(mm(0.1)); board.Add(s)

def outline_poly(inset):
    r = R - inset; fy = FLAT + inset
    a0 = math.atan2(fy - CY, math.sqrt(max(r * r - (fy - CY) ** 2, 0)))
    a1 = math.pi - a0
    pts = []
    n = 72
    for k in range(n + 1):
        a = a0 + (a1 - a0 + 2 * math.pi) * k / n if a1 < a0 else a0 + (a1 - a0) * k / n
        pts.append((CX + r * math.cos(a), CY + r * math.sin(a)))
    return pts

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


# ------------------------------------------------------------------ copper helpers
TRACKS = []
def track(pts, w, layer, netname):
    for a, b in zip(pts, pts[1:]):
        t = pcbnew.PCB_TRACK(board); t.SetStart(V(*a)); t.SetEnd(V(*b)); t.SetWidth(mm(w))
        t.SetLayer(layer); t.SetNet(net(netname)); board.Add(t); TRACKS.append((a, b, w, layer, netname))

VIAS = []
def via(p, netname):
    v = pcbnew.PCB_VIA(board); v.SetPosition(V(*p)); v.SetWidth(mm(VIA_D)); v.SetDrill(mm(VIA_DRILL))
    v.SetNet(net(netname)); v.SetViaType(pcbnew.VIATYPE_THROUGH) if hasattr(pcbnew, 'VIATYPE_THROUGH') else None
    board.Add(v); VIAS.append((p, netname))

def zone(pts, layer_or_layers, netname=None, rule=None, prio=0, clearance=None, name=None):
    z = pcbnew.ZONE(board)
    ls = pcbnew.LSET()
    for l in (layer_or_layers if isinstance(layer_or_layers, (list, tuple)) else [layer_or_layers]):
        ls.AddLayer(l)
    z.SetLayerSet(ls)
    ol = z.Outline(); ol.NewOutline()
    for x, y in pts:
        ol.Append(mm(OX + x), mm(OY + y))
    if rule:
        z.SetIsRuleArea(True)
        z.SetDoNotAllowTracks('tracks' in rule); z.SetDoNotAllowVias('vias' in rule)
        z.SetDoNotAllowZoneFills('pour' in rule); z.SetDoNotAllowPads(False); z.SetDoNotAllowFootprints(False)
    else:
        z.SetNet(net(netname)); z.SetAssignedPriority(prio)
        z.SetLocalClearance(mm(clearance if clearance else 0.2))
        z.SetMinThickness(mm(0.15))
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
        z.SetThermalReliefGap(mm(0.2)); z.SetThermalReliefSpokeWidth(mm(0.25))
    if name: z.SetZoneName(name)
    board.Add(z)
    return z

F, B, IN1, IN2 = pcbnew.F_Cu, pcbnew.B_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu


F, B, IN1, IN2 = pcbnew.F_Cu, pcbnew.B_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu
# ------------------------------------------------------------------ zones / keepouts
mx, my, _ = PLACE['U1']
# antenna is fully off-board; keep vias out from under the LGA module (all used pads escape on F.Cu)
ANT_KEEPOUT = [(mx - 3.4, FLAT - 0.1), (mx + 3.4, FLAT - 0.1), (mx + 3.4, my + 4.8 + 0.4), (mx - 3.4, my + 4.8 + 0.4)]
zone(ANT_KEEPOUT, [F, IN1, IN2, B], rule={'vias'}, name='MODULE_NO_VIAS')
for _pd in FPS['J2'].Pads():
    if _pd.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH:
        _v = _pd.GetPosition(); _x, _y = _v.x / 1e6 - OX, _v.y / 1e6 - OY; _r = 0.75
        zone([(_x - _r, _y - _r), (_x + _r, _y - _r), (_x + _r, _y + _r), (_x - _r, _y + _r)], [F, IN1, IN2, B], rule={'pour', 'vias', 'tracks'}, name='TC2030_HOLE')
full = outline_poly(0.3)
zone(full, IN1, 'GND', clearance=0.2)
zone(full, IN2, '+3V0', clearance=0.2)

# ------------------------------------------------------------------ grid router
G = 0.05
NX, NY = int(round(BW / G)) + 1, int(round(BH / G)) + 1
FREE, BLOCK = -1, -2
occ = np.full((2, NY, NX), FREE, dtype=np.int32)    # layer 0 = F.Cu, 1 = B.Cu
padmask = np.zeros((2, NY, NX), dtype=bool)
NETID = {}
def nid(n):
    if n not in NETID: NETID[n] = len(NETID)
    return NETID[n]

XS = np.arange(NX) * G; YS = np.arange(NY) * G
def cell(p): return (int(round(p[1] / G)), int(round(p[0] / G)))

def mark_rect(L, x0, y0, x1, y1, val, is_pad=False):
    j0, j1 = max(0, int(math.floor(x0 / G))), min(NX - 1, int(math.ceil(x1 / G)))
    i0, i1 = max(0, int(math.floor(y0 / G))), min(NY - 1, int(math.ceil(y1 / G)))
    sub = occ[L, i0:i1 + 1, j0:j1 + 1]
    m = (XS[None, j0:j1 + 1] >= x0 - G / 2) & (XS[None, j0:j1 + 1] <= x1 + G / 2) & (YS[i0:i1 + 1, None] >= y0 - G / 2) & (YS[i0:i1 + 1, None] <= y1 + G / 2)
    conflict = m & (sub != FREE) & (sub != val)
    sub[m] = val
    sub[conflict] = BLOCK if val != BLOCK else BLOCK
    if is_pad: padmask[L, i0:i1 + 1, j0:j1 + 1] |= m

def mark_capsule(L, a, b, r, val):
    x0, x1 = min(a[0], b[0]) - r, max(a[0], b[0]) + r
    y0, y1 = min(a[1], b[1]) - r, max(a[1], b[1]) + r
    j0, j1 = max(0, int(math.floor(x0 / G))), min(NX - 1, int(math.ceil(x1 / G)))
    i0, i1 = max(0, int(math.floor(y0 / G))), min(NY - 1, int(math.ceil(y1 / G)))
    X = XS[None, j0:j1 + 1]; Y = YS[i0:i1 + 1, None]
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = np.clip(((X - a[0]) * dx + (Y - a[1]) * dy) / L2, 0, 1) if L2 > 0 else 0 * X
    d = np.hypot(X - (a[0] + t * dx), Y - (a[1] + t * dy))
    m = d <= r + G / 2
    sub = occ[L, i0:i1 + 1, j0:j1 + 1]
    conflict = m & (sub != FREE) & (sub != val)
    sub[m] = val; sub[conflict] = BLOCK

def pad_layers(pd):
    ls = pd.GetLayerSet(); out = []
    if ls.Contains(F): out.append(0)
    if ls.Contains(B): out.append(1)
    return out

PADS = []   # (ref, num, netname, layers, bbox, center)
for ref, fp in FPS.items():
    for pd in fp.Pads():
        bb = pd.GetBoundingBox()
        x0, y0, x1, y1 = bb.GetLeft() / 1e6 - OX, bb.GetTop() / 1e6 - OY, bb.GetRight() / 1e6 - OX, bb.GetBottom() / 1e6 - OY
        nn = pd.GetNetname()
        layers = pad_layers(pd)
        if pd.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH:
            layers = [0, 1]
        val = nid(nn) if nn else BLOCK
        for L in layers:
            if pd.GetShape(F) == pcbnew.PAD_SHAPE_CIRCLE or pd.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH:
                c = ((x0 + x1) / 2, (y0 + y1) / 2); mark_capsule(L, c, c, (x1 - x0) / 2, val)
            else:
                mark_rect(L, x0, y0, x1, y1, val, is_pad=True)
        PADS.append((ref, pd.GetNumber(), nn, layers, (x0, y0, x1, y1)))

for (a, b, w, layer, nn) in TRACKS:
    mark_capsule(0 if layer == F else 1, a, b, w / 2, nid(nn))
for (p, nn) in VIAS:
    for L in (0, 1): mark_capsule(L, p, p, VIA_D / 2, nid(nn))
DISK = {}
def disk(r):
    if r not in DISK:
        R = int(math.ceil(r))
        DISK[r] = [(di, dj) for di in range(-R, R + 1) for dj in range(-R, R + 1) if di * di + dj * dj < r * r]
    return DISK[r]

def dilate(mask, r):
    out = np.zeros_like(mask)
    H, W = mask.shape
    for di, dj in disk(r):
        si0, si1 = max(0, di), H + min(0, di); sj0, sj1 = max(0, dj), W + min(0, dj)
        out[si0:si1, sj0:sj1] |= mask[si0 - di:si1 - di, sj0 - dj:sj1 - dj]
    return out

def legal_maps(n, w):
    r_t = (CLR + w / 2) / G + 0.55
    r_v = (CLR + VIA_D / 2) / G + 0.55
    tr, vi = [], []
    for L in (0, 1):
        foreign = (occ[L] != FREE) & (occ[L] != n)
        tr.append(~dilate(foreign, r_t))
        vi.append(~dilate(foreign | padmask[L], r_v))   # no via-in-pad
    viaok = vi[0] & vi[1]
    rv = int(math.ceil(0.5 / G))
    for (vp, _vn) in VIAS:   # keep hole-to-hole spacing between all vias
        vi_, vj_ = cell(vp)
        viaok[max(0, vi_ - rv):vi_ + rv + 1, max(0, vj_ - rv):vj_ + rv + 1] = False
    viaok[:, :] &= True
    return tr, viaok

SQ2 = math.sqrt(2)
DIRS = [(0, 1, 1), (0, -1, 1), (1, 0, 1), (-1, 0, 1), (1, 1, SQ2), (1, -1, SQ2), (-1, 1, SQ2), (-1, -1, SQ2)]
VIA_COST = 25.0

def astar(sources, targets, tr, viaok, layers_allowed=(0, 1), max_exp=600000, target_any_via=False):
    """sources/targets: sets of (L,i,j). Returns list of (L,i,j)."""
    tl = list(targets)
    if tl:
        ti = np.array([t[1] for t in tl]); tj = np.array([t[2] for t in tl])
        tbox = (ti.min(), ti.max(), tj.min(), tj.max())
    def h(i, j):
        if target_any_via: return 0
        di = 0 if tbox[0] <= i <= tbox[1] else min(abs(i - tbox[0]), abs(i - tbox[1]))
        dj = 0 if tbox[2] <= j <= tbox[3] else min(abs(j - tbox[2]), abs(j - tbox[3]))
        return max(di, dj) + (SQ2 - 1) * min(di, dj)
    openq = []; g = {}; came = {}; dirof = {}
    for s in sources:
        g[s] = 0; heapq.heappush(openq, (h(s[1], s[2]), 0, s)); came[s] = None; dirof[s] = None
    tset = set(targets); exp = 0
    while openq:
        f, gc, cur = heapq.heappop(openq)
        if gc > g.get(cur, 1e18): continue
        L, i, j = cur
        if (cur in tset) or (target_any_via and viaok[i, j] and cur not in sources):
            path = [cur]
            while came[path[-1]] is not None: path.append(came[path[-1]])
            return path[::-1], (target_any_via and cur not in tset)
        exp += 1
        if exp > max_exp: return None, False
        pd = dirof[cur]
        for di, dj, c in DIRS:
            ni, nj = i + di, j + dj
            if not (0 <= ni < NY and 0 <= nj < NX): continue
            if not tr[L][ni, nj]: continue
            nc = gc + c + (0.6 if pd is not None and pd != (di, dj) else 0)
            nxt = (L, ni, nj)
            if nc < g.get(nxt, 1e18):
                g[nxt] = nc; came[nxt] = cur; dirof[nxt] = (di, dj)
                heapq.heappush(openq, (nc + h(ni, nj), nc, nxt))
        if viaok[i, j]:
            for L2 in layers_allowed:
                if L2 == L or not tr[L2][i, j]: continue
                nxt = (L2, i, j); nc = gc + VIA_COST
                if nc < g.get(nxt, 1e18):
                    g[nxt] = nc; came[nxt] = cur; dirof[nxt] = None
                    heapq.heappush(openq, (nc + h(i, j), nc, nxt))
    return None, False

def commit(path, n_name, w, end_via=False):
    n = nid(n_name)
    segs = []  # (layer, [points])
    cur_L = path[0][0]; pts = [path[0]]
    vias = []
    for a, b in zip(path, path[1:]):
        if a[0] != b[0]:
            segs.append((cur_L, pts)); vias.append((a[2] * G, a[1] * G)); cur_L = b[0]; pts = [b]
        else:
            pts.append(b)
    segs.append((cur_L, pts))
    for L, cells in segs:
        if len(cells) < 2: continue
        # merge colinear
        pp = [cells[0]]
        for k in range(1, len(cells) - 1):
            d1 = (cells[k][1] - pp[-1][1], cells[k][2] - pp[-1][2])
            d2 = (cells[k + 1][1] - cells[k][1], cells[k + 1][2] - cells[k][2])
            if d1[0] * d2[1] - d1[1] * d2[0] != 0: pp.append(cells[k])
        pp.append(cells[-1])
        xy = [(c[2] * G, c[1] * G) for c in pp]
        track(xy, w, F if L == 0 else B, n_name)
        for a, b in zip(xy, xy[1:]): mark_capsule(L, a, b, w / 2, n)
    if end_via:
        vias.append((path[-1][2] * G, path[-1][1] * G))
    for v in vias:
        via(v, n_name)
        for L in (0, 1): mark_capsule(L, v, v, VIA_D / 2, n)

def pad_cells(ref, num, shrink=True):
    if ref == 'pt':
        i, j = cell(num); return {(0, i, j), (1, i, j)}
    for (r, nm, nn, layers, (x0, y0, x1, y1)) in PADS:
        if r == ref and nm == num:
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            i, j = cell((cx, cy))
            cells = set()
            hx, hy = (x1 - x0) / 2 * (0.6 if shrink else 1), (y1 - y0) / 2 * (0.6 if shrink else 1)
            for L in layers:
                for ii in range(int(round((cy - hy) / G)), int(round((cy + hy) / G)) + 1):
                    for jj in range(int(round((cx - hx) / G)), int(round((cx + hx) / G)) + 1):
                        cells.add((L, ii, jj))
            return cells
    raise KeyError((ref, num))

FAIL = []
def connect(n_name, items, w=None, layers=(0, 1)):
    """Route a tree connecting pads `items` [(ref,num)...] in order."""
    w = w or NET_W.get(n_name, W_SIG)
    n = nid(n_name)
    tr, viaok = legal_maps(n, w)
    tree = set(pad_cells(*items[0]))
    for it in items[1:]:
        tgt = pad_cells(*it)
        for c in tree | tgt: tr[c[0]][c[1], c[2]] = True
        path, _ = astar(tree, tgt, tr, viaok, layers)
        if path is None:
            FAIL.append((n_name, items[0], it)); print('  FAIL', n_name, it); continue
        commit(path, n_name, w)
        tr, viaok = legal_maps(n, w)
        tree |= set(path) | tgt

def escape(n_name, ref, num, w=None, maxlen=200000):
    """Short stub from pad to a via into the plane."""
    w = w or NET_W.get(n_name, W_SIG)
    n = nid(n_name)
    tr, viaok = legal_maps(n, w)
    src = pad_cells(ref, num)
    for c in src: tr[c[0]][c[1], c[2]] = True
    path, ok = astar(src, set(), tr, viaok, (src.__iter__().__next__()[0],), max_exp=maxlen, target_any_via=True)
    if path is None:
        FAIL.append((n_name, (ref, num), 'escape')); print('  ESC FAIL', n_name, ref, num); return
    commit(path, n_name, w, end_via=True)


# ------------------------------------------------------------------ board shape for the grid router
Xg, Yg = np.meshgrid(XS, YS)
outside = (np.hypot(Xg - CX, Yg - CY) > R - 0.3) | (Yg < FLAT + 0.3)
for L_ in (0, 1):
    occ[L_][outside] = BLOCK
    ax0, ay0 = ANT_KEEPOUT[0]; ax1, ay1 = ANT_KEEPOUT[2]
    padmask[L_, cell((ax0, ay0))[0]:cell((ax1, ay1))[0] + 1, cell((ax0, ay0))[1]:cell((ax1, ay1))[1] + 1] = True  # no vias
jx, jy, _ = PLACE['J2']
padmask[:, cell((jx - 3.3, jy - 2.0))[0]:cell((jx + 3.3, jy + 2.0))[0], cell((jx - 3.3, jy - 2.0))[1]:cell((jx + 3.3, jy + 2.0))[1]] = True
for ref_ in ('U3', 'U5'):
    pass

# ------------------------------------------------------------------ power: local decoupling + plane escapes
print('routing decoupling + plane escapes')
connect('+3V0', [('U1', 'F6'), ('C2', '1'), ('C1', '1')])
connect('GND', [('U1', 'E1'), ('U1', 'F1')])
connect('+3V0', [('U5', '8'), ('C10', '1'), ('C11', '1')])
connect('+3V0', [('U5', '5'), ('C12', '1')])
connect('+3V0', [('U3', '8'), ('C19', '1'), ('C21', '1')])
connect('+3V0', [('U3', '5'), ('C20', '1')])
connect('+3V0', [('U3', '5'), ('U3', '8')])   # tie VDDIO/VDD locally as well
connect('+3V0', [('U2', '2'), ('C17', '1')])
connect('VBAT', [('U4', '3'), ('C14', '1')])
connect('VBAT', [('U2', '3'), ('C16', '1')])
connect('VCHG', [('U4', '4'), ('C13', '1')])
connect('VCHG', [('TP3', '1'), ('D3', '1')])
SKIP_ESC = {('U1', 'F6'), ('U1', 'E1'), ('U5', '8'), ('U5', '5'), ('U3', '8'), ('U3', '5'), ('U2', '2')}
for (ref, num, nn, layers, bb) in PADS:
    if nn not in ('GND', '+3V0') or (ref, num) in SKIP_ESC:
        continue
    escape(nn, ref, num)

# GND stitching around the rim
n_ = nid('GND'); tr_, viaok_ = legal_maps(n_, 0.2)
for k in range(64):
    a = 2 * math.pi * k / 64
    x, y = CX + (R - 0.9) * math.cos(a), CY + (R - 0.9) * math.sin(a)
    if y < FLAT + 1.0: continue
    i, j = cell((x, y))
    if viaok_[i, j]:
        via((x, y), 'GND')
        for L_ in (0, 1): mark_capsule(L_, (x, y), (x, y), VIA_D / 2, n_)
        tr_, viaok_ = legal_maps(n_, 0.2)

SIGNALS = [
    ('SPI_SCK', [('U1', 'C6'), ('U5', '13'), ('U3', '13')]),
    ('SPI_MOSI', [('U1', 'D6'), ('U5', '14'), ('U3', '14')]),
    ('SPI_MISO', [('U1', 'F5'), ('U5', '1'), ('U3', '1')]),
    ('IMU_CS', [('U1', 'F2'), ('U5', '12')]),
    ('ACC_CS', [('U1', 'A6'), ('U3', '12')]),
    ('IMU_INT1', [('U1', 'A2'), ('U5', '4')]),
    ('IMU_INT2', [('U1', 'B1'), ('U5', '9')]),
    ('ACC_INT1', [('U1', 'A1'), ('U3', '4')]),
    ('ACC_INT2', [('U1', 'D1'), ('U3', '9')]),
    ('VBAT_SENSE', [('U1', 'B6'), ('C18', '1'), ('R4', '1'), ('R3', '2')]),
    ('SWDIO', [('U1', 'A3'), ('J2', '2')]),
    ('SWDCLK', [('U1', 'A4'), ('J2', '4')]),
    ('NRESET', [('U1', 'F3'), ('J2', '3')]),
    ('LED', [('U1', 'A5'), ('R5', '1')]),
    ('LED_A', [('R5', '2'), ('D1', '2')]),
    ('VCHG', [('C13', '1'), ('D3', '1'), ('R8', '1'), ('R9', '1')]),
    ('CHG_DET', [('U1', 'F4'), ('R9', '2'), ('R10', '1')]),
    ('CHG_LED', [('R8', '2'), ('D2', '2')]),
    ('CHG_STAT', [('U4', '1'), ('D2', '1')]),
    ('PROG', [('U4', '5'), ('R7', '1')]),
    ('VBAT', [('TP1', '1'), ('BT1', '1'), ('C22', '1'), ('C14', '1'), ('C16', '1'), ('R3', '1')]),
]

# ------------------------------------------------------------------ silkscreen
def silk(txt, x, y, size=0.8, layer=pcbnew.F_SilkS):
    t = pcbnew.PCB_TEXT(board); t.SetText(txt); t.SetPosition(V(x, y)); t.SetLayer(layer)
    t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size))); t.SetTextThickness(mm(size * 0.15))
    if layer == pcbnew.B_SilkS: t.SetMirrored(True)
    board.Add(t)
for ref, lab in [('TP1', 'BAT+'), ('TP2', 'BAT-'), ('TP3', 'CHG+'), ('TP4', 'CHG-')]:
    px, py = ppos(ref, '1'); silk(lab, px, py - 1.7, 0.7)
silk('SWD', PLACE['J2'][0], PLACE['J2'][1] + 2.5, 0.7)
silk('discyboi v0.4', CX, CY + 13.6, 0.9, pcbnew.B_SilkS)
silk('CR2032 + side out', CX, CY + 15.0, 0.7, pcbnew.B_SilkS)
silk('IMU2 r=9mm', PLACE['U3'][0] - 0.6, PLACE['U3'][1] + 3.4, 0.6)
silk('IMU (centre)', PLACE['U5'][0] + 1.2, PLACE['U5'][1] + 3.6, 0.6)

ROUTER = os.environ.get('ROUTER', 'freerouting')
if ROUTER == 'freerouting':
    print('filling zones before DSN export')
    pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    dsn = os.path.join(SCRATCH, 'v4.dsn'); ses = os.path.join(SCRATCH, 'v4.ses')
    if os.path.exists(ses): os.remove(ses)
    assert pcbnew.ExportSpecctraDSN(board, dsn), 'DSN export failed'
    import re as _re2   # give Freerouting a 5 um margin over KiCad's 0.12 mm rule (it rounds pad corners)
    _d = open(dsn).read(); open(dsn, 'w').write(_re2.sub(r'\(clearance 120\)', '(clearance 125)', _d))
    print('running freerouting')
    r = subprocess.run([FREEROUTING, '-de', dsn, '-do', ses, '--router.autorouter.max_passes=100', '--gui.enabled=false'],
                       capture_output=True, text=True, timeout=900)
    open(os.path.join(SCRATCH, 'freerouting4.log'), 'w').write(r.stdout + r.stderr)
    print('freerouting exit', r.returncode, 'ses exists', os.path.exists(ses))
    assert os.path.exists(ses), 'no SES produced (see freerouting3.log)'
    assert pcbnew.ImportSpecctraSES(board, ses), 'SES import failed'
    for t in board.GetTracks():
        if t.GetClass() == 'PCB_TRACK' and t.GetWidth() < mm(0.1):
            t.SetWidth(mm(0.1))
else:
    print('routing signals with grid router')
    PRIO = [x for x in os.environ.get('ROUTE_PRIO', '').split(',') if x]
    SIGNALS.sort(key=lambda r_: PRIO.index(r_[0]) if r_[0] in PRIO else len(PRIO))
    for r_ in SIGNALS:
        connect(*r_)

zone(full, F, 'GND', clearance=0.2)
zone(full, B, 'GND', clearance=0.2)
print('filling zones')
pcbnew.ZONE_FILLER(board).Fill(board.Zones())
board.Save(os.path.join(OUT, f'{P}.kicad_pcb'))
print('FAILED:', FAIL)
json.dump([f[0] for f in FAIL], open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fail.json'), 'w'))

