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
