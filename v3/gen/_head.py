"""Build v3 discyboi.kicad_pcb: round 28 mm board, Fanstel BC15M module, sensors, LiPo charger.
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
D = 28.0
BW, BH = D, D
R = D / 2
CX, CY = R, R                    # board centre in local coords
FLAT = CY - 10.2                 # straight edge; the BC15M antenna (3.6 mm) overhangs it
mm = pcbnew.FromMM
def V(x, y): return pcbnew.VECTOR2I(mm(float(OX + x)), mm(float(OY + y)))

CLR = 0.12
VIA_D, VIA_DRILL = 0.4, 0.2
W_SIG, W_PWR, W_BAT = 0.15, 0.25, 0.3
NET_W = {'VCHG': W_BAT, 'VBAT': W_BAT, '+3V0': W_PWR, 'GND': W_PWR}

PC = {  # placement relative to board centre (x right, y down), deg
    'U1': (0.0, -9.0, 0),            # module centre; its antenna/shield boundary (y=-1.2 local) sits on FLAT
    'C2': (4.1, -4.4, 90), 'C1': (5.2, -4.4, 90),
    'U5': (0.0, 0.5, 0), 'C10': (2.6, 1.6, 90), 'C11': (3.7, 1.6, 90), 'C12': (-1.4, 2.8, 0),
    'U3': (-9.0, 0.0, 0), 'C19': (-6.4, 1.1, 90), 'C21': (-5.3, 1.1, 90), 'C20': (-10.4, 2.3, 0),
    'R5': (-4.6, -2.6, 0), 'D1': (-4.6, -1.2, 0),
    'J2': (-7.6, -5.6, 0),
    'C18': (-2.2, 6.0, 90), 'R4': (-3.4, 6.0, 90), 'R3': (-4.6, 6.0, 90),
    'U2': (7.6, 1.8, 0), 'C16': (4.9, 2.0, 90), 'C17': (10.4, 1.8, 90),
    'U4': (6.9, 6.4, 0), 'C14': (4.2, 6.4, 90), 'C13': (9.5, 5.6, 90), 'R7': (9.5, 7.6, 90),
    'R8': (11.5, 1.8, 90), 'D2': (11.0, 5.2, 90), 'D3': (1.0, 7.6, 90),
    'R9': (5.4, -6.7, 0), 'R10': (5.4, -7.9, 0),
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
