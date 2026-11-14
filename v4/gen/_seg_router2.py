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
