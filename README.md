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

Cosmos shows four full AM62L DDR phase captures and a length/impedance example.
Each AM62L page has two separate fanouts, 6 mm between their enclosing regions,
and all 33 DDR signals waiting to be routed. Gray copper is fixed fanout copper;
colored copper is the new interconnect. The SoC remains unrotated.

```sh
bun test
bun run typecheck
./benchmark.sh
bun run format:check
```

The repository follows the [handbook bootstrapping guide](https://github.com/tscircuit/handbook/blob/main/guides/bootstrapping-repos.md): Bun, vanilla TypeScript package exports, Biome, CI and a Vite/React Cosmos site. `vercel.json` exports Cosmos for deployment.

## DDR benchmark

`./benchmark.sh` measures the four **full fanout-to-fanout DDR phases**. Before
routing, it checks both fanouts' coverage, their 6 mm separation, exact endpoints,
matching exit layers, absence of pre-routed carrier traces, and independent fixed
copper DRC. It then verifies complete via-free routing and independent DRC of the combined
fanout and interconnect copper, and writes
`benchmark-results.json`. Any invalid sample or unsolved connection fails the run.

The actual tscircuit compositions are in [`examples`](./examples/README.md).
Each uses two `<fanout pcbTracePaths={...}>` components followed by
`<autoroutingphase autorouter="bus_lanes" />`. The phase receives exact preserved
traces; it does not use rectangular approximations of diagonal fanout copper.

The old 12 carrier-prefix cases are retained only as legacy regressions:
`./benchmark.sh --legacy`. They are excluded from the default score and Cosmos
pages. The [historical audit](./DATASET-AUDIT.md) explains their limitations.
Four raw mixed-layer captures remain negative tests and are counted separately.

The automatic solver starts at 0.1 mm, then retries at 0.025 mm using source/target
winding sweeps, reversed sweeps and seam rotations, searching each order from
both ends. This draws on [fanout-solver's winding alternatives](https://github.com/tscircuit/fanout-solver/blob/main/lib/route-via-minimal-winding.ts).
`maxLaneIterations` bounds each search (30,000 by default), and
`maxSearchIterations` bounds the whole solve (5,000,000). Exhaustion is an error.
