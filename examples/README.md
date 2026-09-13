# Two-fanout AM62L examples

Each circuit loads two independent pad-to-exit fanouts and routes all 33 DDR
connections through an explicit phase:

```tsx
<autoroutingphase
  name="DDR_INTERCONNECT"
  phaseIndex={0}
  autorouter="bus_lanes"
/>
```

`TwoFanouts.tsx` contains the complete board. The SoC stays unrotated. The RAM
fanout faces the SoC, with a 6 mm gap between the enclosing fanout regions.
The top/bottom RAM placements are centered on the SoC exit field. The RAM routes
are generated from package pads by the offline grid solver, with reserved exit
approaches and paired layer-sequence constraints. Horizontal RAM fanouts use two
transitions per signal; vertical RAM fanouts use three.
They are not taken from a previously routed carrier.

The carrier phase preserves 66 fixed fanout paths and creates 33 new routes.
It never adds vias. The fixtures in `tests/fixtures/two-fanouts` are the actual
SRJs captured at this phase, including exact fixed traces.

These examples require the core/props `bus_lanes` integration:
[core PR](https://github.com/tscircuit/core/pull/3939),
[props PR](https://github.com/tscircuit/props/pull/851).

Regenerate the authoring data from the AM62L module's saved SoC fanouts and pad
geometry, then build through a core checkout with those changes and dependencies:

```sh
bun scripts/generate-two-fanouts.ts ../am62l-module
bun scripts/capture-two-fanout-phases.tsx ../../work/bus-lanes-core
./benchmark.sh
```

Generation uses 0.075 mm traces and clearance, 0.22 mm blind/buried vias, and a
0.025 mm grid. Fixed copper is checked independently with fanout-solver's DRC;
the captures also require zero core circuit errors. Full package/fanout electrical
delay matching is outside this routing benchmark.
