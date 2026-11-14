
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
