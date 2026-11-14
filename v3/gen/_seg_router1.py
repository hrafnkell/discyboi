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
