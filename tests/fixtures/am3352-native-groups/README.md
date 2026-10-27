# Populated AM3352 DDR routing regressions

These are fresh native pre-routing inputs from a six-layer AM3352 board with
221 components, including 135 capacitors, DDR3, two USB-A ports, USB-C power/PD,
and additional peripherals. Only the 47 DDR connections are routing requests;
the complete physical obstacle field is retained. No saved routes or supplied
vias are loaded. These fixtures do not assert whole-SBC completion.

`ram-minus29` places RAM at (0, -29) mm. `ram-minus25` places it at (0, -25) mm.
The original exploratory layout placed it at (0, -27) mm. All are right-handed
board-world XY in millimetres, +X right and +Y up. These are different placements
of the same circuit, not independently designed schematics.

Capture used core a165eb88a9403c6d7855a2c8d2d054eaef9d53ac and the local populated
AM3352 experiment based on tscircuit/am3352-sbc
bc85a52da8dcad023a3721ca9c90f7a9d29ea3d6. The earlier physical decoupler placements
are retained; this PR does not automatically move capacitors.

The original timing groups are retained with the investigation's explicit length
bounds: byte-group maximums are the longest ordinary pad-to-pad Manhattan path;
address/control minimum is its longest Manhattan path + 6.35 mm, and maximum is
that path + 8.89 mm (capped at 63.5 mm). Skew limits remain 0.635 mm per bus and
0.127 mm per differential pair. The 0.12 mm pair gap is a geometric constraint,
not a stackup-qualified impedance calculation.

Six layers are preserved. Signal carriers are top, inner2, inner3 and bottom;
DDR buses are constrained to inner2/inner3, while RESET may use bottom.
Inner1/inner4 remain reserved for ground. Traces/clearance are 0.1 mm; through
vias have 0.3 mm lands and 0.15 mm holes. Native validation rejects via-in-pad.

`manifest.json` pins decompressed fixture bytes. The loader checks every hash.
Run fresh default solves and independent validation with:

```sh
bun scripts/benchmark-native-groups.ts --sample ram-minus29 --output .cache/native-head
bun scripts/benchmark-native-groups.ts --sample ram-minus25 --output .cache/native-nearer
```

For a comparison, pass `--solver /path/to/pinned/checkout/lib/index.ts` for each
revision with the same harness, fixtures, runtime, dependencies and 300-second
budget. Successful routes are saved only after connectivity, DRC, timing,
coupling and all 11 native checks pass. Failures remain in the report; no partial
or failed routing images are exported.
