# @tscircuit/bus-lanes-solver

Step-based, via-free bus routing for `SimpleRouteJson`, with `BaseSolver` and `GenericSolverDebugger` from `@tscircuit/solver-utils`.

```ts
import { BusLanesSolver } from "@tscircuit/bus-lanes-solver"

const solver = new BusLanesSolver(simpleRouteJson, { gridStep: 0.05 })
solver.solve()
if (solver.failed) throw new Error(solver.error!)
const routed = solver.getOutput()
```

Each connection must have exactly two terminals on the same fixed layer. The solver never emits vias, changes terminal layers, or falls back to a multilayer router. Existing copper and obstacles remain fixed. Declared bus order controls lane routing order; planar congestion, crossed lane orders, unsupported constraints, and exhausted search budgets produce explicit failures. A grid-search failure is not a mathematical proof that no continuous planar solution exists.

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

Raw captures intentionally fail: SoC exits are on inner layers and RAM pads on top. Planar corridor captures terminate at the **first existing carrier via**, freeze the rest of the RAM route, and preserve other copper as obstacles. They isolate the same-layer problem; they do not claim that the complete RAM connection is via-free. Some captures remain difficult/failed cases at the selected grid resolution; those are retained for debugging rather than relabeled as successes.

```sh
bun test
bun run typecheck
bun scripts/check-fixtures.ts
bun run format:check
```

The repository follows the [handbook bootstrapping guide](https://github.com/tscircuit/handbook/blob/main/guides/bootstrapping-repos.md): Bun, vanilla TypeScript package exports, Biome, CI and a Vite/React Cosmos site. `vercel.json` exports Cosmos for deployment.
