"""Write discyboi.kicad_pro with design rules + netclasses (JLCPCB 4-layer capable)."""
import json, os, sys, uuid
OUT = sys.argv[1]
ROOT_UUID = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'discyboi3.root'))


def nc(name, clr, w, prio, color='rgba(0, 0, 0, 0.000)'):
    return {"name": name, "clearance": clr, "track_width": w, "via_diameter": 0.4, "via_drill": 0.2,
            "microvia_diameter": 0.3, "microvia_drill": 0.1, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25,
            "diff_pair_width": 0.2, "bus_width": 12, "wire_width": 6, "line_style": 0, "priority": prio,
            "pcb_color": color, "schematic_color": "rgba(0, 0, 0, 0.000)"}


pro = {
    "meta": {"filename": "discyboi.kicad_pro", "version": 3},
    "board": {
        "design_settings": {
            "rules": {
                "max_error": 0.005, "min_clearance": 0.1, "min_connection": 0.0,
                "min_copper_edge_clearance": 0.25, "min_hole_clearance": 0.2, "min_hole_to_hole": 0.25,
                "min_microvia_diameter": 0.2, "min_microvia_drill": 0.1, "min_resolved_spokes": 1,
                "min_silk_clearance": 0.0, "min_text_height": 0.5, "min_text_thickness": 0.08,
                "min_through_hole_diameter": 0.2, "min_track_width": 0.1, "min_via_annular_width": 0.09,
                "min_via_diameter": 0.35, "solder_mask_to_copper_clearance": 0.0,
                "use_height_for_length_calcs": True,
            },
            "track_widths": [0.0, 0.15, 0.2, 0.3],
            "via_dimensions": [{"diameter": 0.0, "drill": 0.0}, {"diameter": 0.4, "drill": 0.2}],
            "rule_severities": {"silk_over_copper": "ignore", "silk_overlap": "warning", "lib_footprint_issues": "ignore",
                                "lib_footprint_mismatch": "ignore"},
        },
    },
    "net_settings": {
        "meta": {"version": 4},
        "classes": [
            nc("Default", 0.12, 0.15, 2147483647),
            nc("Power", 0.12, 0.3, 0, "rgb(255, 128, 0)"),
            nc("RF", 0.12, 0.3, 1, "rgb(255, 255, 0)"),
        ],
        "netclass_patterns": [
            {"netclass": "Power", "pattern": "VBAT*"},
            {"netclass": "Power", "pattern": "+3V0"},
            {"netclass": "Power", "pattern": "GND"},
            {"netclass": "Power", "pattern": "DCC"},
            {"netclass": "Power", "pattern": "DEC*"},
            {"netclass": "RF", "pattern": "RF*"},
            {"netclass": "RF", "pattern": "ANT"},
        ],
    },
    "sheets": [[ROOT_UUID, "Root"]],
    "text_variables": {},
}
with open(os.path.join(OUT, 'discyboi.kicad_pro'), 'w') as f:
    json.dump(pro, f, indent=2)
print('wrote project')
