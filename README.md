# @tscircuit/bus-lanes-solver

Step-based, via-free bus routing for `SimpleRouteJson`, with `BaseSolver` and `GenericSolverDebugger` from `@tscircuit/solver-utils`.

```ts
import { BusLanesSolver } from "@tscircuit/bus-lanes-solver"

const solver = new BusLanesSolver(simpleRouteJson, { gridStep: 0.05 })
solver.solve()
if (solver.failed) throw new Error(solver.error!)
const routed = solver.getOutput()
```

Each connection must have exactly two terminals on the same fixed layer. The solver never emits vias, changes terminal layers, or falls back to a multilayer router. Existing copper and obstacles remain fixed. Geometric winding sweeps, seam rotations and reverse searches choose lane order; planar congestion, crossed lane orders, unsupported constraints, and exhausted search budgets produce explicit failures. A grid-search failure is not a mathematical proof that no continuous planar solution exists.

## Constraints

- `buses[].connectionNames`: connections belonging to the bus, in routing order.
- `buses[].maxLengthSkew`: maximum difference in routed lengths, in millimeters. The solver adds clearance-checked tuning detours and verifies the final result.
- `buses[].targetImpedance`: desired single-ended impedance in ohms.
- `buses[].impedanceProfile`: `{ layer, points: [{ traceWidth, impedance }] }`, with widths in millimeters and impedances in ohms. Supply a table computed for your actual stackup by a field solver or fabricator. Widths must increase as impedance decreases. The solver interpolates within the table, never extrapolates or assumes a stackup. An explicit `traceWidth` must agree with the target.
- `buses[].allowedLayers`: must contain the fixed terminal layer.
- `differentialPairs[].lengthTolerance`: supported as a routed-length constraint. Coupled-pair `traceGap` and `maxUncoupledLength` constraints are explicitly rejected; this solver does not yet enforce coupled-pair geometry.

Matching here applies to the routes produced by this phase. It does not include package delays or fixed fanout delays. A width table is a geometry model, not signal-integrity qualification. No undocumented impedance or delay defaults are supplied.

## tscircuit integration

The accompanying core/props changes introduce:

```tsx
<autoroutingphase name="DATA_LANES" phaseIndex={1} autorouter="bus_lanes" />
<bus
  name="DATA"
  connections={["DATA0", "DATA1"]}
  routingPhaseIndex={1}
  maxLengthSkew="0.1mm"
  targetImpedance="50ohm"
  pcbImpedanceProfile={{
    layer: "top",
    points: [
      { traceWidth: "0.1mm", impedance: "60ohm" },
      { traceWidth: "0.2mm", impedance: "40ohm" },
    ],
  }}
/>
```

The table above is illustrative, not a production stackup. Core forwards bus impedance intent and the profile to SRJ. Fanout phases must establish matching fixed-layer endpoints before this phase runs. Failed lane routing does not trigger a global-router fallback.

## Debugger

```sh
bun install
bun run start
bun run build:site
```

Cosmos includes four raw AM62L DDR captures and twelve planar corridor pages (BYTE0, BYTE1 and command/address for each orientation), plus a small matching example. Use Step, Animate and Solve in `GenericSolverDebugger`. Source/target labels include the layer; candidate paths, frontier nodes, fixed copper and committed lanes are rendered separately. Input and graphics downloads make failures reproducible.

Raw captures intentionally fail: SoC exits are on inner layers and RAM pads on top. Planar corridor captures terminate at the **first existing carrier via**, freeze the rest of the RAM route, and preserve other copper as obstacles. They isolate the same-layer problem; they do not claim that the complete RAM connection is via-free. Explicit coarse grid settings may still fail; the automatic setting retries winding orders on a finer grid.

```sh
bun test
bun run typecheck
./benchmark.sh
bun run format:check
```

The repository follows the [handbook bootstrapping guide](https://github.com/tscircuit/handbook/blob/main/guides/bootstrapping-repos.md): Bun, vanilla TypeScript package exports, Biome, CI and a Vite/React Cosmos site. `vercel.json` exports Cosmos for deployment.

## DDR benchmark

Current result: **12/12 same-layer samples solved (132 lanes), 4/4 expected
layer-change rejections**. The checked-in report includes iterations, attempts and
elapsed time. These are isolated same-layer corridors, not complete via-free RAM
connections. `fixture-results.json` retains the original 10,000-iteration baseline.

Run `./benchmark.sh` from this repository (Bun required). It routes all twelve
same-layer AM62L samples without modifying their terminals, obstacles or widths,
prints the solved count, and writes `benchmark-results.json`. Four raw mixed-layer
captures are checked separately as expected `layer_change_required` rejections;
they are never counted as solved. The command exits nonzero if any positive
sample fails or an expected rejection is missing.

The automatic solver starts at 0.1 mm, then retries at 0.025 mm using geometric
source/target winding sweeps, reversed sweeps and seam rotations. Each order is
searched from both endpoint directions. Retries discard only newly routed copper;
all input copper and terminal reservations remain fixed. Every committed segment
is checked again for clearance and 0/45/90-degree geometry before acceptance.

This draws on [fanout-solver's winding route-order alternatives](https://github.com/tscircuit/fanout-solver/blob/main/lib/route-via-minimal-winding.ts).
`maxLaneIterations` bounds each search (default 30,000); `maxSearchIterations`
bounds the entire solve (default 5,000,000). Exhausting either all alternatives
or the total budget remains an error. Grid resolution can be fixed explicitly
with `gridStep`, including in Cosmos.
