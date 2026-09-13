# Historical AM62L carrier-prefix dataset audit

Superseded by the actual two-fanout phase captures in `tests/fixtures/two-fanouts`.
The default benchmark and Cosmos now use those captures. This audit describes
only the retained legacy cases.

The current planar fixtures reconstruct the prefix of a completed carrier route.
The exporter selects the **first via from the SoC end** and freezes the rest of
that connection. That via is not an independently generated RAM fanout exit.
Consequently, the 12/12 benchmark does not validate routing between two fanouts.

| DDR orientation | Connections shorter than 1 mm | Median test gap | Median selected-via to RAM-pad distance |
| --- | ---: | ---: | ---: |
| Left | 20 / 33 | 0.813 mm | 6.081 mm |
| Right | 11 / 33 | 3.072 mm | 8.098 mm |
| Top | 19 / 33 | 0.804 mm | 13.089 mm |
| Bottom | 17 / 33 | 0.735 mm | 12.659 mm |

Distances are straight-line XY distances. They do not measure electrical length.
The audit found no positive-area overlap between the saved DDR SoC fanout bounds
and retained DDR carrier-tail bounds, and no different-net same-layer copper
contacts in the modeled wire segments and via spans between those two sets.
This is a scoped overlap check, not a complete board DRC. Gray copper reaching
back towards the SoC belongs to the already routed carrier tail; it should not
be interpreted as an independent RAM fanout.

A representative replacement dataset needs both component fanouts generated
before carrier routing, fixed same-layer exit terminals for each DDR connection,
and an explicit separation between the two fanout regions. Capture the SRJ at
that boundary with **all carrier routes absent**. Keep all 33 DDR connections in
the full-orientation tests so byte-bank tests cannot freeze the other banks'
solutions. Audit fixed copper independently before counting a solve.

The original samples are preserved, labeled as legacy regressions. No endpoints,
clearance rules or routes were changed to improve their score.

Reproduce the audit with:

```sh
bun scripts/audit-ddr-fixtures.ts ../am62l-module
```

Detailed endpoint coordinates and measured bounds are in
[`ddr-fixture-audit.json`](./ddr-fixture-audit.json).
