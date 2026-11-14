"""Generate discyboi.kicad_sym, discyboi.kicad_sch, project + lib tables."""
import json, os, re, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from design import PARTS, PWR_FLAGS, P, POS, NOTES, CUSTOM_SYMBOLS, TITLE

OUT = sys.argv[1]
KLIB = '/usr/share/kicad/symbols/'
U = lambda: str(uuid.uuid4())
ROOT_UUID = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'discyboi3.root'))


def sym_uuid(ref):  # deterministic so the PCB can link to it
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, 'discyboi3.sym.' + ref))


def block(t, i):
    d = 0
    j = i
    while True:
        c = t[j]
        if c == '(':
            d += 1
        elif c == ')':
            d -= 1
            if d == 0:
                return t[i:j + 1]
        j += 1


def lib_symbol(lib, name, text=None):
    t = text if text is not None else open(KLIB + lib + '.kicad_sym').read()
    i = t.find('(symbol "%s"' % name)
    assert i >= 0, (lib, name)
    return block(t, i)


def fnt(hide=False, justify=None):
    s = '(effects (font (size 1.27 1.27))'
    if justify:
        s += f' (justify {justify})'
    if hide:
        s += ' (hide yes)'
    return s + ')'


# ------------------------------------------------------------------ custom symbol library
def adxl375_symbol():
    s = lib_symbol('Sensor_Motion', 'ADXL343').replace('ADXL343', 'ADXL375')
    s = re.sub(r'\(property "Datasheet" "[^"]*"', '(property "Datasheet" "https://www.analog.com/media/en/technical-documentation/data-sheets/ADXL375.pdf"', s)
    s = re.sub(r'\(property "Description" "[^"]*"', '(property "Description" "3-axis +/-200g digital accelerometer, SPI/I2C, LGA-14 3x5mm"', s)
    return s


def write_symlib():
    body = CUSTOM_SYMBOLS(fnt)
    with open(os.path.join(OUT, f'{P}.kicad_sym'), 'w') as f:
        f.write(f'(kicad_symbol_lib (version 20251024) (generator "discyboi_gen") (generator_version "10.0")\n{body}\n)\n')
    return body


# ------------------------------------------------------------------ schematic
def pin_list(symtext):
    """Return [(number, x, y, angle)] for unit-1 + common pins in a lib symbol."""
    out = []
    for m in re.finditer(r'\(pin \w+ \w+\s*\(at ([-\d.]+) ([-\d.]+) (\d+)\)', symtext):
        blk = block(symtext, m.start())
        num = re.search(r'\(number "([^"]*)"', blk).group(1)
        out.append((num, float(m.group(1)), float(m.group(2)), int(m.group(3))))
    return out


OUTWARD = {0: (-1, 0), 180: (1, 0), 90: (0, 1), 270: (0, -1)}  # schematic coords (y down)
LABEL_ANG = {0: 180, 180: 0, 90: 0, 270: 0}


def r(v):
    return round(v * 100) / 100


def main():
    os.makedirs(OUT, exist_ok=True)
    custom = write_symlib()
    libsyms = {}
    items = []

    def get_sym(lib_id):
        if lib_id not in libsyms:
            lib, name = lib_id.split(':')
            src = lib_symbol(lib, name, custom if lib == P else None)
            assert '(extends' not in src, lib_id
            libsyms[lib_id] = src.replace(f'(symbol "{name}"', f'(symbol "{lib_id}"', 1)
        return libsyms[lib_id]

    def place(ref, lib_id, value, fp, pins_net, at, extra_props=None, dnp=False, power=False, in_bom=True):
        sym = get_sym(lib_id)
        x0, y0 = at
        su = sym_uuid(ref) if not power else U()
        props = [('Reference', ref, (x0 + 2.54, y0 - 3.81), power), ('Value', value, (x0 + 2.54, y0 + 3.81), power),
                 ('Footprint', fp, (x0, y0), True), ('Datasheet', '', (x0, y0), True),
                 ('Description', '', (x0, y0), True)]
        for k, v in (extra_props or {}).items():
            props.append((k, v, (x0, y0), True))
        if lib_id.endswith(('ADXL375', 'LSM6DSV16X', 'BC15M')):
            props[0] = ('Reference', ref, (x0 + 7.62, y0 - 15.24), False)
            props[1] = ('Value', value, (x0 + 7.62, y0 + 15.24), False)
        pins = pin_list(sym)
        s = [f'(symbol (lib_id "{lib_id}") (at {x0} {y0} 0) (unit 1) (exclude_from_sim no) (in_bom {"no" if (power or not in_bom) else "yes"}) (on_board {"no" if power else "yes"}) (dnp {"yes" if dnp else "no"}) (uuid "{su}")']
        for k, v, (px, py), hide in props:
            s.append(f'  (property "{k}" "{v}" (at {r(px)} {r(py)} 0) {fnt(hide, None if hide else "left")})')
        for num, *_ in pins:
            s.append(f'  (pin "{num}" (uuid "{U()}"))')
        s.append(f'  (instances (project "{P}" (path "/{ROOT_UUID}" (reference "{ref}") (unit 1))))')
        s.append(')')
        items.append('\n'.join(s))
        done = set()
        for num, px, py, ang in pins:
            ex, ey = r(x0 + px), r(y0 - py)
            if (ex, ey) in done:
                continue
            done.add((ex, ey))
            net = pins_net.get(num, None)
            if net is None:
                items.append(f'(no_connect (at {ex} {ey}) (uuid "{U()}"))')
                continue
            dx, dy = OUTWARD[ang]
            lx, ly = r(ex + dx * 2.54), r(ey + dy * 2.54)
            items.append(f'(wire (pts (xy {ex} {ey}) (xy {lx} {ly})) (stroke (width 0) (type default)) (uuid "{U()}"))')
            la = LABEL_ANG[ang]
            just = 'right bottom' if la == 180 else 'left bottom'
            just = 'right' if la == 180 else 'left'
            items.append(f'(global_label "{net}" (shape passive) (at {lx} {ly} {la}) (fields_autoplaced yes) {fnt(justify=just)} (uuid "{U()}") (property "Intersheetrefs" "${{INTERSHEET_REFS}}" (at {lx} {ly} 0) {fnt(True)}))')

    for p in PARTS:
        extra = {}
        if p.get('mpn'):
            extra['MPN'] = p['mpn']
        if p.get('lcsc'):
            extra['LCSC'] = p['lcsc']
        if p.get('mfr'):
            extra['Manufacturer'] = p['mfr']
        place(p['ref'], p['lib'], p['value'], p['fp'], p['pins'], POS[p['ref']], extra, p.get('dnp', False), in_bom=p.get('in_bom', True))

    for i, net in enumerate(PWR_FLAGS):
        place(f'#FLG0{i + 1}', 'power:PWR_FLAG', 'PWR_FLAG', '', {'1': net}, (238.76 + i * 20.32, 43.18), power=True)

    for (x, y), txt in NOTES:
        items.append(f'(text "{txt}" (exclude_from_sim no) (at {x} {y} 0) (effects (font (size 1.524 1.524)) (justify left bottom)) (uuid "{U()}"))')

    sch = f'''(kicad_sch (version 20250610) (generator "eeschema") (generator_version "10.0")
(uuid "{ROOT_UUID}")
(paper "A3")
(title_block (title "{TITLE}") (date "2026-11-13") (rev "0.3"))
(lib_symbols
{chr(10).join(libsyms.values())}
)
{chr(10).join(items)}
(sheet_instances (path "/" (page "1")))
(embedded_fonts no)
)
'''
    with open(os.path.join(OUT, f'{P}.kicad_sch'), 'w') as f:
        f.write(sch)
    with open(os.path.join(OUT, 'sym-lib-table'), 'w') as f:
        f.write(f'(sym_lib_table\n  (version 7)\n  (lib (name "{P}")(type "KiCad")(uri "${{KIPRJMOD}}/{P}.kicad_sym")(options "")(descr "discyboi custom symbols"))\n)\n')
    print('wrote schematic with', len(PARTS), 'parts')


main()
