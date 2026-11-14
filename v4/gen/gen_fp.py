"""Fanstel BC15M land pattern, from the BC15 datasheet mechanical drawing (top view).
Module 6.0 x 9.6 mm, PCB trace antenna in the top 3.6 mm (-Y), 36 LGA pads in a 6x6 grid,
0.9 mm pitch, 0.4 mm round pads; pad A6 centre is 0.75 mm from the left and 0.7 mm from the bottom edge.
Edge pads (column A, column F, row 6) run out to the module edge on the module; here they are extended
0.3 mm past the outline so the solder joint can be inspected / touched up.
Footprint origin = module centre. The host-board edge belongs at y = -1.2 (antenna fully off-board)."""
import os, sys
OUT = sys.argv[1]
W, H = 6.0, 9.6
COLS = 'ABCDEF'
PITCH, PD, EXT = 0.9, 0.4, 0.3
xs = [-W / 2 + 0.75 + PITCH * i for i in range(6)]          # A..F
ys = [H / 2 - 0.7 - PITCH * (5 - k) for k in range(6)]      # rows 1..6 (row 6 at the bottom edge)
ANT_EDGE = -H / 2 + 3.6                                      # = -1.2, end of the shield / start of antenna
pads = []
def roundpad(num, x, y, w, h):
    pads.append(f'\t(pad "{num}" smd roundrect (at {x:.3f} {y:.3f}) (size {w:.3f} {h:.3f}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.5))')
def circ(num, x, y):
    pads.append(f'\t(pad "{num}" smd circle (at {x:.3f} {y:.3f}) (size {PD} {PD}) (layers "F.Cu" "F.Paste" "F.Mask"))')
for i, c in enumerate(COLS):
    for k in range(6):
        num, x, y = f'{c}{k + 1}', xs[i], ys[k]
        if k == 5:                                   # bottom row -> extend down past the edge
            y1 = H / 2 + EXT; y0 = y - PD / 2
            roundpad(num, x, (y0 + y1) / 2, PD, y1 - y0)
        elif c == 'A':                               # left column -> extend left
            x0 = -W / 2 - EXT; x1 = x + PD / 2
            roundpad(num, (x0 + x1) / 2, y, x1 - x0, PD)
        elif c == 'F':
            x0 = x - PD / 2; x1 = W / 2 + EXT
            roundpad(num, (x0 + x1) / 2, y, x1 - x0, PD)
        else:
            circ(num, x, y)
L = lambda x1, y1, x2, y2, layer, w: f'\t(fp_line (start {x1:.3f} {y1:.3f}) (end {x2:.3f} {y2:.3f}) (stroke (width {w}) (type solid)) (layer "{layer}"))'
t, b, l, r = -H / 2, H / 2, -W / 2, W / 2
g = [L(l, t, r, t, 'F.Fab', 0.1), L(r, t, r, b, 'F.Fab', 0.1), L(r, b, l, b, 'F.Fab', 0.1), L(l, b, l, t, 'F.Fab', 0.1),
     L(l, ANT_EDGE, r, ANT_EDGE, 'F.Fab', 0.1),
     # silk: short ticks at the top corners of the shielded part + pin-A1 marker
     L(l - 0.15, ANT_EDGE + 0.15, l - 0.15, ys[0] - 0.45, 'F.SilkS', 0.12),
     L(r + 0.15, ANT_EDGE + 0.15, r + 0.15, ys[0] - 0.45, 'F.SilkS', 0.12),
     L(l - 0.15, ANT_EDGE + 0.15, l + 0.6, ANT_EDGE + 0.15, 'F.SilkS', 0.12),
     f'\t(fp_circle (center {l - 0.55:.3f} {ys[0]:.3f}) (end {l - 0.45:.3f} {ys[0]:.3f}) (stroke (width 0.2) (type solid)) (fill yes) (layer "F.SilkS"))']
cy = (l - EXT - 0.25, t - 0.25, r + EXT + 0.25, b + EXT + 0.25)
g += [L(cy[0], cy[1], cy[2], cy[1], 'F.CrtYd', 0.05), L(cy[2], cy[1], cy[2], cy[3], 'F.CrtYd', 0.05),
      L(cy[2], cy[3], cy[0], cy[3], 'F.CrtYd', 0.05), L(cy[0], cy[3], cy[0], cy[1], 'F.CrtYd', 0.05)]
txt = lambda kind, val, y, layer, hide=False: (f'\t(property "{kind}" "{val}" (at 0 {y} 0) (layer "{layer}")' +
      (' (hide yes)' if hide else '') + ' (effects (font (size 0.6 0.6) (thickness 0.1))))')
mod = '\n'.join([
    '(footprint "Fanstel_BC15M" (version 20241229) (generator "discyboi_gen") (layer "F.Cu")',
    '\t(descr "Fanstel BC15M nRF54L15 module, PCB trace antenna, 6.0x9.6mm, 36-pad LGA 6x6 0.9mm pitch. '
    'Antenna (top 3.6mm) must overhang the host board edge (board edge at y=-1.2)")',
    '\t(tags "nRF54L15 BLE module LGA Fanstel")',
    txt('Reference', 'REF**', b + 1.0, 'F.SilkS', True),
    txt('Value', 'BC15M', 1.5, 'F.Fab'),
    txt('Datasheet', '', 0, 'F.Fab', True),
    txt('Description', '', 0, 'F.Fab', True),
    '\t(attr smd)',
    f'\t(fp_text user "ANTENNA" (at 0 {t + 1.8:.2f}) (layer "F.Fab") (effects (font (size 0.6 0.6) (thickness 0.1))))',
    *g, *pads, ')', ''])
os.makedirs(os.path.join(OUT, 'discyboi.pretty'), exist_ok=True)
open(os.path.join(OUT, 'discyboi.pretty', 'Fanstel_BC15M.kicad_mod'), 'w').write(mod)

# ---------------------------------------------------------------- Linx BAT-HLD-003-SMT (CR2032 retainer)
# Land pattern from C-BAT-HLD-003-SMT rev A: two 5.7 x 6.1 mm tab pads, 31.5 mm over the outside,
# and a round pad under the cell (the cell's negative face). The drawing shows 17.9 mm; this uses
# 14 mm, still well inside the flat negative face of a CR2032, to free a ring of bottom-layer routing
# under the cell (traces there stay under solder mask). Origin = cell centre, on the tab
# centre line. Drawn on the front layers; the board script flips it to the bottom side. The clip's
# pointed (closed) end is +y; the cell slides in from -y.
import math as _m
def bat_fp():
    TABX, TW, TH, PADD = 31.5 / 2 - 5.7 / 2, 5.7, 6.1, 14.0
    out = ['(footprint "Linx_BAT-HLD-003-SMT" (version 20241229) (generator "discyboi_gen") (layer "F.Cu")',
           '\t(descr "TE Connectivity / Linx BAT-HLD-003-SMT CR2032 coin cell retainer, SMT tabs; negative contact is a 14 mm PCB pad")',
           '\t(tags "battery holder CR2032 coin cell retainer")',
           txt('Reference', 'REF**', 12.0, 'F.SilkS', True), txt('Value', 'CR2032', 0, 'F.Fab'),
           txt('Datasheet', '', 0, 'F.Fab', True), txt('Description', '', 0, 'F.Fab', True), '\t(attr smd)']
    for x in (-TABX, TABX):
        out.append(f'\t(pad "1" smd rect (at {x:.3f} 0) (size {TW} {TH}) (layers "F.Cu" "F.Paste" "F.Mask"))')
    out.append(f'\t(pad "2" smd circle (at 0 0) (size {PADD} {PADD}) (layers "F.Cu" "F.Mask"))')
    # fab: cell + clip outline
    out.append('\t(fp_circle (center 0 0) (end 10 0) (stroke (width 0.1) (type solid)) (fill no) (layer "F.Fab"))')
    clip = [(-15.25, -2.55), (-10.55, -2.55), (-10.55, -7.4), (-6.5, -9.35), (-3.0, -7.0), (3.0, -7.0), (6.5, -9.35),
            (10.55, -7.4), (10.55, -2.55), (15.25, -2.55), (15.25, 2.55), (10.55, 2.55), (10.55, 6.9), (6.95, 10.45),
            (-6.95, 10.45), (-10.55, 6.9), (-10.55, 2.55), (-15.25, 2.55), (-15.25, -2.55)]
    for a, b in zip(clip, clip[1:]):
        out.append(L(a[0], a[1], b[0], b[1], 'F.Fab', 0.1))
    # silk: cell outline, broken where it would cross the tab pads
    r, pts = 10.35, []
    for k in range(121):
        a = 2 * _m.pi * k / 120
        x, y = r * _m.cos(a), r * _m.sin(a)
        pts.append(None if (abs(x) > 9.4 and abs(y) < TH / 2 + 0.35) else (x, y))
    for a, b in zip(pts, pts[1:]):
        if a and b:
            out.append(L(a[0], a[1], b[0], b[1], 'F.SilkS', 0.12))
    # '+' marks on the clip side (the clip is the positive contact)
    for x in (-13.0, 13.0):
        out.append(L(x - 0.6, 4.4, x + 0.6, 4.4, 'F.SilkS', 0.15)); out.append(L(x, 3.8, x, 5.0, 'F.SilkS', 0.15))
    # courtyard: clip outline + 0.3 mm, plus the cell where it sticks out of the open end
    cy = [(-16.0, -3.35), (-10.85, -3.35), (-10.85, -7.6), (-6.5, -9.7), (-3.0, -10.3), (3.0, -10.3), (6.5, -9.7),
          (10.85, -7.6), (10.85, -3.35), (16.0, -3.35), (16.0, 3.35), (10.85, 3.35), (10.85, 7.0), (7.1, 10.75),
          (-7.1, 10.75), (-10.85, 7.0), (-10.85, 3.35), (-16.0, 3.35), (-16.0, -3.35)]
    for a, b in zip(cy, cy[1:]):
        out.append(L(a[0], a[1], b[0], b[1], 'F.CrtYd', 0.05))
    out += [')', '']
    return '\n'.join(out)
open(os.path.join(OUT, 'discyboi.pretty', 'Linx_BAT-HLD-003-SMT.kicad_mod'), 'w').write(bat_fp())
open(os.path.join(OUT, 'fp-lib-table'), 'w').write('(fp_lib_table\n  (version 7)\n  (lib (name "discyboi")(type "KiCad")(uri "${KIPRJMOD}/discyboi.pretty")(options "")(descr "discyboi footprints"))\n)\n')
print('wrote footprint')
