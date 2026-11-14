for (a, b, w, layer, nn) in TRACKS:
    mark_capsule(0 if layer == F else 1, a, b, w / 2, nid(nn))
for (p, nn) in VIAS:
    for L in (0, 1): mark_capsule(L, p, p, VIA_D / 2, nid(nn))