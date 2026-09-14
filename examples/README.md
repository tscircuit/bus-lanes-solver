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
options, and output. Each package is solved separately, with compatible handoff
layers and winding order established through `connectionExitTargets`. Escape
bands and local directions provide room for the required ordering inside each
fanout. The downstream phase restores the two byte groups and command/address
group and routes all 33 signals together. No generated route vertices are edited.

The saved recipes use fanout-solver 0.0.78. All eight fanouts reproduce exactly;
all four complete interconnects pass combined-copper DRC and complete core builds
with zero circuit errors. The interconnect solver adds no vias. Timing closure
and transition counts inside the fixed package fanouts are separate concerns.

These circuits require [core PR #3939](https://github.com/tscircuit/core/pull/3939)
and [props PR #851](https://github.com/tscircuit/props/pull/851).

```sh
# Re-run the real package solver with the recorded inputs and options.
bun scripts/generate-two-fanouts.ts
# Build the full circuits and capture their actual bus_lanes phase inputs.
bun scripts/capture-two-fanout-phases.tsx ../../work/bus-lanes-core
# Require all four full interconnects to solve within one second each.
./benchmark.sh
```

Use `--capture-only` only when collecting a failing input without completing its build.
Capture-only intentionally stops at the autorouting event; its partial circuit
is not a successful board build. The solver benchmark consumes the captured SRJ.
Provenance checks compare every fixed path to its original output with floating-point
coordinate tolerance, preserving widths, layer spans, and connectivity.

Each logical DDR bus requests `maxLengthSkew={0.1}`. Matching includes the immutable fanout copper and new carriers; the benchmark checks all three groups in every orientation.
