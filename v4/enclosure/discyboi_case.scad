// discyboi v4 enclosure: base (glued under the disc's flight plate) + screw-on lid.
//
// The board sits component side DOWN in the base (towards the disc), so the battery side faces
// the ground and the lid is the battery door. With the board top facing the disc's top, use the
// "Face up" board-mount setting in the web app.
//
// Frame: z = 0 is the face that sticks to the disc. x/y are the board as seen from the lid side
// (i.e. the KiCad top view mirrored left-right): the module and its antenna point to +y.
//
// Parts (set `part`): "assembly", "exploded", "base", "lid", "jig", "print" (base + lid laid out).
// Hardware: 3 x M2 countersunk screws, 8 mm (self-tapping into the printed posts, or machine
// screws into 2.0 mm holes tapped by the screw itself). Print in PETG or TPU, not PLA.

/* [What to render] */
part = "exploded";            // [assembly, exploded, base, lid, jig, print]
battery = "coin";             // [coin, lipo]

/* [Board] */
pcb_t = 1.0;                  // board thickness you ordered (1.0 mm; use 1.6 / 0.8 if different)
pcb_r = 17.0;                 // Ø34 mm
pcb_flat = 10.2;              // flat edge, distance from centre (antenna side, +y)
top_h = 2.4;                  // component side clearance: module 2.0 mm, C22 1206 ≤1.8 mm
clip_h = 3.9;                 // BAT-HLD-003-SMT height above the board
lipo_t = 4.6;                 // 20x20x4.5 pouch + tape
cell_y = -2.5;                // cell centre (KiCad (0, +2.5), mirrored into this frame)

/* [Case] */
clr = 0.3;                    // board-to-pocket clearance (radial)
wall = 1.4;
floor_t = 0.8;                // disc side; thin is fine, it's glued down
lid_t = 1.2;
win_t = 0.4;                  // floor thickness over the LEDs (print the base in a translucent colour)
press = 0.25;                 // how hard the lid boss pushes on the clip / LiPo (interference)
post_angles = [90, 210, 330];
lip = 0.8;                    // chamfer on the lid's outer edge
charge_notch = false;         // wire slot for charging a LiPo build (CHG pads face the disc)

/* [Centring jig] */
disc_inner_d = 165;           // inside diameter of the disc's rim, measured at the flight plate
jig_t = 2.0;

$fn = 96;

// ------------------------------------------------------------------ derived
bot_h = (battery == "coin" ? clip_h : lipo_t) + 0.3;
r_in = pcb_r + clr;                     // pocket radius
r_out = r_in + wall;
z_top = floor_t + top_h;                // board top surface (faces down, towards the disc)
z_bot = z_top + pcb_t;                  // board bottom surface (battery side)
H = z_bot + bot_h + lid_t;              // overall height
z_lid = H - lid_t;                      // underside of the lid plate = top of the base wall
hole_d = 1.7;                           // M2 self-tap pilot
post_r = r_in + hole_d / 2 + 0.9;       // post centre radius (hole clears the pocket wall)
lobe_r = hole_d / 2 + 1.5;
lid_post_t = 2.4;                       // lid thickness at the screws (room for the countersink)
z_post = H - lid_post_t;                // top of the base posts

// board-frame features (KiCad top view (xk, yk) -> here (-xk, -yk))
function k2s(p) = [-p[0], -p[1]];
LED_D1 = k2s([-4.6, -1.2]);             // green status LED (top side, faces the disc)
LED_D2 = k2s([11.0, 5.2]);              // red charge LED (LiPo build)
TAB_A = [12.9, cell_y];                 // clip tab pads (bottom side)

module outline2d(extra = 0) {
    hull() {
        circle(r = r_out + extra);
        for (a = post_angles) rotate(a) translate([post_r, 0]) circle(r = lobe_r + extra);
    }
}

module board2d(grow = 0) {
    intersection() {
        circle(r = pcb_r + grow);
        translate([-50, -50]) square([100, 50 + pcb_flat + grow]);
    }
}

module post_xy() { for (a = post_angles) rotate(a) translate([post_r, 0]) children(); }

// ------------------------------------------------------------------ base
module base() {
    difference() {
        union() {
            difference() {
                linear_extrude(z_lid) outline2d();
                translate([0, 0, floor_t]) cylinder(r = r_in, h = H);
            }
            // rim ledge the board's top face rests on (outside every top-side part)
            difference() {
                cylinder(r = r_in, h = z_top);
                cylinder(r = pcb_r - 0.4, h = H);
            }
            // keys along the board's flat: support it there and stop it rotating.
            // |x| < 4.6 stays open for the module's antenna overhang.
            intersection() {
                cylinder(r = r_in, h = z_bot);
                for (s = [-1, 1]) translate([s > 0 ? 4.6 : -50, pcb_flat + clr, 0]) cube([50 - 4.6, 20, z_bot]);
            }
            // screw posts, trimmed back to the pocket wall
            difference() {
                post_xy() cylinder(r = lobe_r, h = z_post);
                translate([0, 0, floor_t]) cylinder(r = r_in, h = H);
            }
        }
        post_xy() translate([0, 0, z_post - 6]) cylinder(d = hole_d, h = 7);
        // recess for the lid's thicker screw bosses
        post_xy() translate([0, 0, z_post]) cylinder(r = lobe_r + 0.2, h = H);
        // thin windows over the LEDs
        for (p = [LED_D1, LED_D2]) translate([p[0], p[1], win_t]) cylinder(d = 3.2, h = floor_t);
        if (charge_notch)
            rotate(265) translate([r_in - 1, -1.5, floor_t]) cube([wall + 3, 3, top_h]);
    }
}

// ------------------------------------------------------------------ lid
module lid() {
    difference() {
        union() {
            // plate with a chamfered outer edge
            hull() {
                translate([0, 0, z_lid]) linear_extrude(lid_t - lip) outline2d();
                translate([0, 0, H - 0.01]) linear_extrude(0.01) offset(delta = -lip) outline2d();
            }
            // thicker around the screws (into the space above the base posts)
            difference() {
                post_xy() translate([0, 0, z_post]) cylinder(r = lobe_r, h = lid_post_t);
                cylinder(r = r_in, h = z_lid);
            }
            // clamp ring on the board rim, notched where the clip's tabs are soldered
            difference() {
                translate([0, 0, z_bot]) cylinder(r = r_in - 0.2, h = z_lid - z_bot);
                cylinder(r = pcb_r - 0.5, h = H);
                for (s = [-1, 1]) {
                    t = [s * TAB_A[0], TAB_A[1]];
                    rotate(atan2(t[1], t[0])) translate([pcb_r - 2, -4, 0]) cube([4, 8, H]);
                }
            }
            // boss pressing the clip (coin) or the pouch (LiPo) onto the board
            translate([0, cell_y, z_bot + bot_h - 0.3 - press]) cylinder(d = 8, h = 0.3 + press + 0.01);
            // stop at the clip's open end so the cell can't slide out on impact
            translate([-5, cell_y + 10.6, z_bot + 0.4]) cube([10, 1.2, z_lid - z_bot - 0.4]);
        }
        post_xy() {
            cylinder(d = 2.3, h = H + 1);
            translate([0, 0, H - 1.15]) cylinder(d1 = 2.3, d2 = 4.0, h = 1.16);
        }
    }
}

// ------------------------------------------------------------------ centring jig
// Drops into the underside of the disc against the rim; the base sits in its centre pocket.
module jig() {
    rr = disc_inner_d / 2 - 0.5;
    difference() {
        union() {
            linear_extrude(jig_t + 2) outline2d(2.0);
            for (a = [0, 120, 240]) rotate(a) {
                translate([0, -4, 0]) cube([rr, 8, jig_t]);
                translate([rr - 3, -6, 0]) cube([3, 12, jig_t + 3]);
            }
        }
        translate([0, 0, -1]) linear_extrude(jig_t + 4) outline2d(0.3);
    }
}

// ------------------------------------------------------------------ board mock (preview only)
module board_mock() {
    color("darkgreen") translate([0, 0, z_top]) linear_extrude(pcb_t) board2d();
    color("silver") translate([-3, 9.0 - 4.8, z_top - 2.0]) cube([6, 9.6, 2.0]);   // BC15M, antenna past the flat
    if (battery == "coin") {
        color("lightgrey") translate([0, cell_y, z_bot]) cylinder(d = 20, h = 3.2);
        color("goldenrod") translate([-10.55, cell_y - 10.45, z_bot + 3.65]) cube([21.1, 19.8, 0.25]);   // clip (approx.)
    } else {
        color("lightsteelblue") translate([-10, cell_y - 10, z_bot]) cube([20, 20, 4.5]);
    }
}

// ------------------------------------------------------------------ output
if (part == "base") base();
else if (part == "lid") translate([0, 0, H]) rotate([180, 0, 0]) lid();
else if (part == "jig") jig();
else if (part == "print") {
    base();
    translate([2 * (post_r + lobe_r) + 4, 0, H]) rotate([180, 0, 0]) lid();
} else if (part == "assembly") {
    color("orange", 0.55) base();
    board_mock();
    color("orange", 0.35) lid();
} else if (part == "exploded") {
    color("orange") base();
    translate([0, 0, 8]) board_mock();
    color("darkorange") translate([0, 0, 18]) lid();
}

echo(str("overall height ", H, " mm, width ", 2 * (post_r + lobe_r), " mm (", 2 * r_out, " mm without the screw lobes)"));
