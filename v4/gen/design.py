"""discyboi v4: Fanstel BC15M (nRF54L15) module + 2x LSM6DSV320X, CR2032 holder on the bottom, round 34 mm PCB.
The LiPo charger stays on the board but is not fitted (DNP); fit it only for a rechargeable LIR2032."""

P = 'discyboi'
TITLE = 'discyboi v4 - Fanstel BC15M + 2x LSM6DSV320X + CR2032'

C0402 = 'Capacitor_SMD:C_0402_1005Metric'
R0402 = 'Resistor_SMD:R_0402_1005Metric'

# LCSC codes (JLCPCB). Passives are JLC basic parts.
LCSC = {
    ('C', '100n'): 'C1525', ('C', '1u'): 'C52923', ('C', '10u'): 'C15525', ('C', '4.7u'): 'C23733',
    ('C', '2.2u'): 'C12530', ('C', '10n'): 'C15195', ('C', '100u'): 'C15008',
    ('R', '1k'): 'C11702', ('R', '10k'): 'C25744', ('R', '100k'): 'C25741', ('R', '47k'): 'C25819',
}


# Manufacturer part numbers (DigiKey-stocked). LCSC codes above are the JLCPCB equivalents.
MPN = {
    ('C', '100n'): ('Samsung', 'CL05B104KO5NNNC'), ('C', '1u'): ('Samsung', 'CL05A105KA5NQNC'),
    ('C', '10u'): ('Samsung', 'CL05A106MQ5NUNC'), ('C', '4.7u'): ('Samsung', 'CL05A475MP5NRNC'),
    ('C', '2.2u'): ('Samsung', 'CL05A225MQ5NSNC'), ('C', '100u'): ('Samsung', 'CL31A107MQHNNNE'),
    ('R', '1k'): ('Yageo', 'RC0402FR-071KL'), ('R', '10k'): ('Yageo', 'RC0402FR-0710KL'), ('R', '100k'): ('Yageo', 'RC0402FR-07100KL'), ('R', '47k'): ('Yageo', 'RC0402FR-0747KL'),
    ('R', '10M'): ('Yageo', 'RC0402FR-0710ML'),
}


def cap(ref, val, n1, n2, fp=C0402, **kw):
    m = MPN.get(('C', val), (None, None))
    return dict(ref=ref, lib='Device:C_Small', value=val, fp=fp, pins={'1': n1, '2': n2},
                lcsc=LCSC.get(('C', val)), mfr=m[0], mpn=m[1], **kw)


def res(ref, val, n1, n2, fp=R0402, **kw):
    m = MPN.get(('R', val), (None, None))
    return dict(ref=ref, lib='Device:R_Small', value=val, fp=fp, pins={'1': n1, '2': n2},
                lcsc=LCSC.get(('R', val)), mfr=m[0], mpn=m[1], **kw)


# ---------------------------------------------------------------- Fanstel BC15M pin map (datasheet "BC15C Pin Functions")
MOD_PINS = {
    'A1': 'P0.01', 'A2': 'P0.00', 'A3': 'SWDIO', 'A4': 'SWDCLK', 'A5': 'P2.09', 'A6': 'P2.05',
    'B1': 'P1.08', 'B2': 'P0.03', 'B3': 'P2.07', 'B4': 'P1.07', 'B5': 'P1.05', 'B6': 'P1.06',
    'C1': 'P2.10', 'C2': 'P0.02', 'C3': 'P1.09', 'C4': 'P2.00', 'C5': 'P1.04', 'C6': 'P2.01',
    'D1': 'P1.12', 'D2': 'P1.10', 'D3': 'P2.08', 'D4': 'P1.14', 'D5': 'P1.11', 'D6': 'P2.02',
    'E1': 'GND', 'E2': 'P1.13', 'E3': 'P0.04', 'E4': 'P2.03', 'E5': 'P1.15', 'E6': 'P1.02',
    'F1': 'GND', 'F2': 'P2.06', 'F3': 'NRESET', 'F4': 'P1.03', 'F5': 'P2.04', 'F6': 'VDD',
}
# Only perimeter pads (columns A/F, rows 1 and 6) are used so that every signal escapes on F.Cu without vias.
# Interrupt lines sit on P0/P1 (GPIOTE30/GPIOTE20); SPIM00 uses its dedicated port-2 pins.
MOD_NETS = {
    'F6': '+3V0', 'E1': 'GND', 'F1': 'GND',
    'A3': 'SWDIO', 'A4': 'SWDCLK', 'F3': 'NRESET',
    'C6': 'SPI_SCK',    # P2.01  SPIM00 SCK
    'D6': 'SPI_MOSI',   # P2.02  SPIM00 SDO
    'F5': 'SPI_MISO',   # P2.04  SPIM00 SDI
    'F2': 'IMU_CS',     # P2.06
    'A6': 'ACC_CS',     # P2.05
    'A2': 'IMU_INT1',   # P0.00
    'B1': 'IMU_INT2',   # P1.08
    'A1': 'ACC_INT1',   # P0.01
    'D1': 'ACC_INT2',   # P1.12
    'B6': 'VBAT_SENSE', # P1.06 / AIN2
    'A5': 'LED',        # P2.09
    'F4': 'CHG_DET',    # P1.03 (NFC2 pad, used as GPIO): high = charger connected, wake source
}

ICM_PINS = {  # LSM6DSV320X (DS14623 rev 3, table 2; same pinout as LSM6DSV16X) - SPI 4-wire, aux/Qvar unused
    '1': ('SDO/SA0', 'tri_state'), '2': ('SDx', 'passive'), '3': ('SCx', 'passive'), '4': ('INT1', 'output'),
    '5': ('VDDIO', 'power_in'), '6': ('GND', 'power_in'), '7': ('GND', 'power_in'), '8': ('VDD', 'power_in'),
    '9': ('INT2', 'bidirectional'), '10': ('OCS_Aux', 'passive'), '11': ('SDO_Aux', 'passive'), '12': ('CS', 'input'),
    '13': ('SCL/SPC', 'input'), '14': ('SDA/SDI', 'input'),
}
# SDx/SCx -> GND (analog hub/Qvar disabled), OCS_Aux/SDO_Aux unconnected (datasheet table 2, mode 1)
ICM_NETS = {'1': 'SPI_MISO', '2': 'GND', '3': 'GND', '4': 'IMU_INT1', '5': '+3V0', '6': 'GND', '7': 'GND',
            '8': '+3V0', '9': 'IMU_INT2', '10': None, '11': None, '12': 'IMU_CS', '13': 'SPI_SCK', '14': 'SPI_MOSI'}

ACC_NETS = {'1': 'SPI_MISO', '2': 'GND', '3': 'GND', '4': 'ACC_INT1', '5': '+3V0', '6': 'GND', '7': 'GND',
            '8': '+3V0', '9': 'ACC_INT2', '10': None, '11': None, '12': 'ACC_CS', '13': 'SPI_SCK', '14': 'SPI_MOSI'}

PARTS = [
    # ---------------- module
    dict(ref='U1', lib=f'{P}:BC15M', value='BC15M', fp=f'{P}:Fanstel_BC15M',
         pins={k: MOD_NETS.get(k) for k in MOD_PINS}, mfr='Fanstel', mpn='BC15M', in_bom=False),
    cap('C1', '10u', '+3V0', 'GND'),
    cap('C2', '100n', '+3V0', 'GND'),
    # ---------------- IMU (center of the board)
    dict(ref='U5', lib=f'{P}:LSM6DSV16X', value='LSM6DSV320XTR', fp='Package_LGA:LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y',
         pins=ICM_NETS, mfr='STMicroelectronics', mpn='LSM6DSV320XTR'),
    cap('C10', '100n', '+3V0', 'GND'),
    cap('C11', '1u', '+3V0', 'GND'),
    cap('C12', '100n', '+3V0', 'GND'),
    # ---------------- second LSM6DSV320X off-centre (r=9mm, same orientation as U5): spin rate from the
    # centripetal difference U3-U5 (gyro clips at 4000 dps = 667 rpm; low-g covers ~1260 rpm, high-g beyond)
    dict(ref='U3', lib=f'{P}:LSM6DSV16X', value='LSM6DSV320XTR', fp='Package_LGA:LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y',
         pins=ACC_NETS, mfr='STMicroelectronics', mpn='LSM6DSV320XTR'),
    cap('C19', '100n', '+3V0', 'GND'),
    cap('C21', '1u', '+3V0', 'GND'),
    cap('C20', '100n', '+3V0', 'GND'),
    # ---------------- power: CR2032 holder (bottom side) -> MCP1700 3.0V. The MCP73831 charger path is
    # kept on the board but NOT FITTED (dnp): fit U4/R7/R8/D2/C13/D3/R9 only with a rechargeable LIR2032
    # (R7 = 47k charges at ~21 mA). Never fit the charger with a primary CR2032.
    dict(ref='BT1', lib='Device:Battery_Cell', value='CR2032', fp=f'{P}:Linx_BAT-HLD-003-SMT',
         pins={'1': 'VBAT', '2': 'GND'}, mfr='TE Connectivity Linx', mpn='BAT-HLD-003-SMT', side='bottom'),
    cap('C22', '100u', 'VBAT', 'GND', fp='Capacitor_SMD:C_1206_3216Metric'),   # bulk: carries the radio's TX bursts
    dict(ref='TP3', lib='Connector:TestPoint', value='CHG+ (5V)', fp='TestPoint:TestPoint_Pad_2.0x2.0mm', pins={'1': 'VCHG'}, in_bom=False),
    dict(ref='TP4', lib='Connector:TestPoint', value='CHG-', fp='TestPoint:TestPoint_Pad_2.0x2.0mm', pins={'1': 'GND'}, in_bom=False),
    dict(ref='TP1', lib='Connector:TestPoint', value='BAT+', fp='TestPoint:TestPoint_Pad_2.0x2.0mm', pins={'1': 'VBAT'}, in_bom=False),
    dict(ref='TP2', lib='Connector:TestPoint', value='BAT-', fp='TestPoint:TestPoint_Pad_2.0x2.0mm', pins={'1': 'GND'}, in_bom=False),
    dict(ref='D3', lib='Device:D_Zener_Small', value='ESD5Z5.0T1G', fp='Diode_SMD:D_SOD-523',
         pins={'1': 'VCHG', '2': 'GND'}, mfr='onsemi', mpn='ESD5Z5.0T1G', lcsc='C82044', dnp=True),
    cap('C13', '4.7u', 'VCHG', 'GND', dnp=True),
    dict(ref='U4', lib='Battery_Management:MCP73831-2-OT', value='MCP73831T-2ACI/OT', fp='Package_TO_SOT_SMD:SOT-23-5',
         pins={'1': 'CHG_STAT', '2': 'GND', '3': 'VBAT', '4': 'VCHG', '5': 'PROG'}, mfr='Microchip', mpn='MCP73831T-2ACI/OT', lcsc='C424093', dnp=True),
    res('R7', '47k', 'PROG', 'GND', dnp=True),   # 1000V/47k = 21 mA: ~0.5C for a ~40 mAh LIR2032
    cap('C14', '4.7u', 'VBAT', 'GND'),
    res('R8', '1k', 'VCHG', 'CHG_LED', dnp=True),
    dict(ref='D2', lib='Device:LED_Small', value='Red', fp='LED_SMD:LED_0603_1608Metric',
         pins={'1': 'CHG_STAT', '2': 'CHG_LED'}, mfr='Lite-On', mpn='LTST-C191KRKT', lcsc='C2286', dnp=True),
    dict(ref='U2', lib='Regulator_Linear:MCP1700x-300xxTT', value='MCP1700T-3002E/TT', fp='Package_TO_SOT_SMD:SOT-23',
         pins={'1': 'GND', '2': '+3V0', '3': 'VBAT'}, mfr='Microchip', mpn='MCP1700T-3002E/TT', lcsc='C62244'),
    cap('C16', '1u', 'VBAT', 'GND'),
    cap('C17', '1u', '+3V0', 'GND'),
    res('R3', '10M', 'VBAT', 'VBAT_SENSE'),      # 10M/10M: 0.2 uA standing drain; C18 holds the node for the ADC
    res('R4', '10M', 'VBAT_SENSE', 'GND'),
    res('R9', '100k', 'VCHG', 'CHG_DET', dnp=True),   # charger detect (LIR2032 build only): 5V -> 2.5V into P1.03
    res('R10', '100k', 'CHG_DET', 'GND'),             # fitted: keeps P1.03 low when R9 is not fitted
    cap('C18', '100n', 'VBAT_SENSE', 'GND'),
    # ---------------- debug + status LED
    dict(ref='J2', lib='Connector:Conn_ARM_SWD_TagConnect_TC2030', value='TC2030-IDC-NL',
         fp='Connector:Tag-Connect_TC2030-IDC-NL_2x03_P1.27mm_Vertical',
         pins={'1': '+3V0', '2': 'SWDIO', '3': 'NRESET', '4': 'SWDCLK', '5': 'GND', '6': None}, in_bom=False),
    res('R5', '1k', 'LED', 'LED_A'),
    dict(ref='D1', lib='Device:LED_Small', value='Green', fp='LED_SMD:LED_0603_1608Metric',
         pins={'1': 'GND', '2': 'LED_A'}, mfr='Lite-On', mpn='LTST-C191KGKT', lcsc='C72043'),
]

PWR_FLAGS = ['GND', 'VCHG']


# ---------------------------------------------------------------- schematic placement
def _grid(refs, x0, y0, dx=17.78, dy=20.32, per_row=6):
    return {r: (x0 + (i % per_row) * dx, y0 + (i // per_row) * dy) for i, r in enumerate(refs)}


POS = {'U1': (106.68, 116.84), 'U5': (226.06, 116.84), 'U3': (226.06, 177.8), 'J2': (63.5, 231.14),
       'U4': (276.86, 55.88), 'U2': (345.44, 55.88)}
POS.update(_grid(['C1', 'C2'], 33.02, 101.6))
POS.update(_grid(['C10', 'C11', 'C12'], 271.78, 111.76))
POS.update(_grid(['C19', 'C20', 'C21'], 271.78, 172.72))
POS.update(_grid(['TP3', 'TP4', 'D3', 'C13'], 25.4, 50.8, dx=20.32))
POS.update(_grid(['TP1', 'TP2', 'C14', 'R7', 'R8', 'D2'], 116.84, 50.8, dx=20.32))
POS.update(_grid(['BT1', 'C22'], 381.0, 55.88, dx=17.78))
POS.update(_grid(['R9', 'R10'], 25.4, 71.12, dx=20.32))
POS.update(_grid(['C16', 'C17', 'R3', 'R4', 'C18'], 312.42, 86.36, dx=17.78))
POS.update(_grid(['R5', 'D1'], 116.84, 231.14, dx=22.86))

NOTES = [
    ((20.32, 33.02), 'CR2032 (BT1, bottom side) + 100uF bulk -> MCP1700 3.0V LDO. Charger U4/R7/R8/D2/C13/D3/R9 = DNP (fit only for LIR2032)'),
    ((20.32, 88.9), 'Fanstel BC15M nRF54L15 module (36-pad LGA, reflow). PCB antenna overhangs the board edge'),
    ((180.34, 88.9), 'LSM6DSV320X IMU (+/-4000 dps, +/-16g + 320g high-g) at the board centre (SPI, shared bus)'),
    ((180.34, 152.4), '2nd LSM6DSV320X at r=9mm: spin rate from centripetal acceleration (U3 minus U5)'),
    ((20.32, 215.9), 'SWD (Tag-Connect TC2030-NL) + status LED'),
]


# ---------------------------------------------------------------- custom symbols
def CUSTOM_SYMBOLS(fnt):
    def pin(et, x, y, ang, name, num):
        return f'(pin {et} line (at {x} {y:.2f} {ang}) (length 2.54) (name "{name}" {fnt()}) (number "{num}" {fnt()}))'

    # module: left = power/debug, right = GPIO
    left = ['F6', None, 'A3', 'A4', 'F3', None, 'E1', 'F1']
    gpio = [k for k in MOD_PINS if k not in left]
    gpio.sort(key=lambda k: (MOD_PINS[k][:2], float(MOD_PINS[k][1:])))
    pins = []
    y = 22.86
    for k in left:
        if k:
            et = {'VDD': 'power_in', 'GND': 'power_in', 'SWDCLK': 'input', 'SWDIO': 'bidirectional', 'NRESET': 'bidirectional'}[MOD_PINS[k]]
            pins.append(pin(et, -17.78, y, 0, MOD_PINS[k], k))
        y -= 2.54
    y = 22.86
    for k in gpio:
        pins.append(pin('bidirectional', 17.78, y, 180, MOD_PINS[k], k))
        y -= 2.54
    h = 25.4
    mod = f'''(symbol "BC15M" (pin_names (offset 1.016)) (exclude_from_sim no) (in_bom yes) (on_board yes)
  (property "Reference" "U" (at -15.24 {h + 1.27} 0) {fnt(justify="left")})
  (property "Value" "BC15M" (at -15.24 {-h - 41.0} 0) {fnt(justify="left")})
  (property "Footprint" "discyboi:Fanstel_BC15M" (at 0 0 0) {fnt(True)})
  (property "Datasheet" "https://www.mouser.com/pdfDocs/BC15MProductSpecifications.pdf" (at 0 0 0) {fnt(True)})
  (property "Description" "Fanstel BC15M nRF54L15 module, PCB antenna, 6.0x9.6mm, 36-pad LGA" (at 0 0 0) {fnt(True)})
  (symbol "BC15M_0_1" (rectangle (start -15.24 {h}) (end 15.24 {y + 1.27:.2f}) (stroke (width 0.254) (type default)) (fill (type background))))
  (symbol "BC15M_1_1"
    {chr(10).join("    " + p for p in pins)}
  )
)'''
    # LSM6DSV16X
    lp = [('14', 5.08), ('13', 2.54), ('12', 0), ('1', -2.54)]
    rp = [('4', 5.08), ('9', 2.54)]
    tp = [('8', -2.54), ('5', 2.54)]
    bp = [('6', -5.08), ('2', -2.54), ('3', 0), ('7', 2.54)]
    nc = [('10', 5.08), ('11', 7.62)]
    ip = []
    for n, yy in lp: ip.append(pin(ICM_PINS[n][1], -12.7, yy, 0, ICM_PINS[n][0], n))
    for n, yy in rp: ip.append(pin(ICM_PINS[n][1], 12.7, yy, 180, ICM_PINS[n][0], n))
    for n, xx in tp: ip.append(pin(ICM_PINS[n][1], xx, 12.7, 270, ICM_PINS[n][0], n))
    for n, xx in bp: ip.append(pin(ICM_PINS[n][1], xx, -12.7, 90, ICM_PINS[n][0], n))
    for n, yy in nc: ip.append(pin('passive', 12.7, -yy + 2.54, 180, ICM_PINS[n][0], n))
    icm = f'''(symbol "LSM6DSV16X" (pin_names (offset 1.016)) (exclude_from_sim no) (in_bom yes) (on_board yes)
  (property "Reference" "U" (at -10.16 11.43 0) {fnt(justify="left")})
  (property "Value" "LSM6DSV16X" (at 2.54 -11.43 0) {fnt(justify="left")})
  (property "Footprint" "Package_LGA:LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y" (at 0 0 0) {fnt(True)})
  (property "Datasheet" "https://www.st.com/resource/en/datasheet/lsm6dsv320x.pdf" (at 0 0 0) {fnt(True)})
  (property "Description" "LSM6DSV320X 6-axis IMU, +/-4000dps, +/-16g low-g + +/-320g high-g accel, SPI/I2C/I3C, LGA-14L 2.5x3mm (LSM6DSV16X-compatible)" (at 0 0 0) {fnt(True)})
  (symbol "LSM6DSV16X_0_1" (rectangle (start -10.16 10.16) (end 10.16 -10.16) (stroke (width 0.254) (type default)) (fill (type background))))
  (symbol "LSM6DSV16X_1_1"
    {chr(10).join("    " + p for p in ip)}
  )
)'''
    return mod + '\n' + icm
