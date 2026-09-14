# Two-fanout AM62L routing examples

Each circuit loads exact `FanoutSolver` paths for the SoC and RAM, then requests:

```tsx
<autoroutingphase name="DDR_INTERCONNECT" phaseIndex={0} autorouter="bus_lanes" />
```

`TwoFanouts.tsx` contains the shared board. The packages are 58 mm apart along
the DDR direction and offset 4 mm transversely. Each solver uses a 40 mm shared
boundary; copper-containing regions have 17.76 mm between them. The chip is not
rotated to change the DDR orientation.

Every record in `fanout-solver-outputs` contains the real package solver's input,
options, and output. Each package is solved independently. Physical escape groups
contain individual signals or complete differential pairs; the downstream phase
restores the two byte groups and command/address group and routes all 33 signals
together. Escape guidance uses each package's own pad tracks, not the opposite
fanout's exits. No route vertices or terminal coordinates are edited afterward.

The saved recipes use fanout-solver 0.0.78. All eight fanouts are complete and
pass independent copper DRC. They are diagnostic routing fixtures: the left
case's independently selected layers disagree on 28 handoffs, and the other
three interconnects currently exhaust the bus solver's search budget. Full DDR
timing closure and equal transition counts are not established.

These circuits require [core PR #3939](https://github.com/tscircuit/core/pull/3939)
and [props PR #851](https://github.com/tscircuit/props/pull/851).

```sh
# Re-run the real package solver with the recorded inputs and options.
bun scripts/generate-two-fanouts.ts
# Capture the actual phase SRJ before attempting its interconnect routing.
bun scripts/capture-two-fanout-phases.tsx ../../work/bus-lanes-core --capture-only
# Count complete interconnect solves; currently exits nonzero (0/4).
./benchmark.sh
```

Omit `--capture-only` to let the full circuit routing finish and record its errors.
Capture-only intentionally stops at the autorouting event; its partial circuit
is not a successful board build. The solver benchmark consumes the captured SRJ.
Provenance checks compare every fixed path to its original output with floating-point
coordinate tolerance, preserving widths, layer spans, and connectivity.
