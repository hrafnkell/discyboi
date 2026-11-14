
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
