# @tscircuit/bus-lanes-solver

Step-based, via-free bus routing for `SimpleRouteJson`, with `BaseSolver` and `GenericSolverDebugger` from `@tscircuit/solver-utils`.

```ts
import { BusLanesSolver } from "@tscircuit/bus-lanes-solver"

const solver = new BusLanesSolver(simpleRouteJson)
solver.solve()
if (solver.failed) throw new Error(solver.error!)
const routed = solver.getOutput()
```

Each connection must have exactly two terminals on the same fixed layer. The solver never emits vias, changes terminal layers, or falls back to a multilayer router. Existing copper and obstacles remain fixed. Geometric winding sweeps, seam rotations and reverse searches choose lane order; planar congestion, crossed lane orders, unsupported constraints, and exhausted search budgets produce explicit failures. A bounded visibility-graph search failure is not a proof that no continuous planar solution exists.

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
Each AM62L page has two separate, real `FanoutSolver` outputs and all 33 DDR
signals waiting to be routed. The enclosing regions are 17.76 mm apart, with a
4 mm transverse package offset. Fixed and newly routed copper share stable
layer colors; all layers are present at iteration zero, including via rings.
The SoC remains unrotated.

```sh
bun test
bun run typecheck
./benchmark.sh
bun run format:check
```

The repository follows the [handbook bootstrapping guide](https://github.com/tscircuit/handbook/blob/main/guides/bootstrapping-repos.md): Bun, vanilla TypeScript package exports, Biome, CI and a Vite/React Cosmos site. `vercel.json` exports Cosmos for deployment.

## DDR benchmark

`./benchmark.sh` measures four complete DDR interconnect inputs captured from
an actual `bus_lanes` phase. Every sample contains 66 fixed paths produced by
`@tscircuit/fanout-solver@0.0.78`. Input/options/output records are committed in
[`examples/fanout-solver-outputs`](./examples/fanout-solver-outputs). Tests rerun
all eight package fanouts and compare the generated paths.

Before routing, the benchmark verifies record hashes, original output geometry,
continuous wire/via joins, 33 paths per package, at least 6 mm region separation,
exact exits, and independent fixed-copper DRC. Exit-layer mismatches are reported
as routing failures, not repaired or removed from the denominator. Complete
interconnects must also pass independent combined-copper DRC.

**Current result: 4/4 full interconnects (132/132 signals), with combined-copper
DRC passing.** All four core circuit builds complete with zero circuit errors.
The measured solves take 7–103 ms on the development machine; the benchmark
records solve time and time including output DRC separately.

FanoutSolver receives compatible handoff layers and winding guidance. The left
case locks successful SoC layer assignments, guides the strobe-pair order, and
uses a RAM corner bank for the remaining data group. Bottom escapes the SoC's
left-side ball field before turning toward its bottom boundary. Neither changes
the SoC ball positions or rotation. Every fixed path is a real saved solver
output; generated coordinates are never edited. These are routing checks, not
complete DDR timing closure or equal-transition-count claims for fixed fanouts.

Each sample runs in a separate process, with the solver's ordinary 200,000
iteration budget and a one-second benchmark deadline. Override the deadline with
`./benchmark.sh --timeout-seconds 2`. Timeouts and partial paths are failures.
Results are written to `benchmark-results.json`; a failed positive sample makes
the command exit nonzero. Four original mixed-layer negatives are counted separately.

The [tscircuit examples](./examples/README.md) load these exact fanouts and use
`<autoroutingphase autorouter="bus_lanes" />`. Capturing the input is separate
from solving it, so a failed router cannot hide the input that caused it.

The older 12 carrier-prefix cases remain available with `--legacy`; they are
excluded from the default score and Cosmos pages. The prior grid-generated,
aligned two-fanout data is superseded as well.

The router uses a continuous octilinear visibility graph built from offset
copper geometry. Lane ordering starts with layer-separated transverse winding
sweeps, routes the outside of a bend first, and retains alternate seams. Clear
analytic paths skip visibility-graph construction entirely. `maxLaneIterations` bounds vertex expansions
per lane (4,000 by default); `maxSearchIterations` bounds the whole solve
(200,000). There is no grid resolution option.

See the [visual iteration audit](./docs/vector-routing.md) for inspected baseline
and replacement snapshots. Cosmos includes a staggered obstacle channel in
addition to all four real AM62L captures.
