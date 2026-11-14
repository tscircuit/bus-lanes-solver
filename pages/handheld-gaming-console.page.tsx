import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { SingleLayerConnectivitySolver } from "../lib/single-layer-connectivity-solver"
import type { SimpleRouteJson } from "../lib/types"
import fixture from "../tests/fixtures/handheld-gaming-console/input.srj.json"

const snapshotUrl = new URL(
  "../tests/__snapshots__/handheld-routing-snapshot.snap.svg",
  import.meta.url,
).href

export default (
  <main style={{ fontFamily: "system-ui", padding: 20 }}>
    <h1>Handheld Gaming Console</h1>
    <p>
      RK3562 / LPDDR4X repro: 65 signals on a six-layer board. This is the
      connectivity experiment from the snapshot test. DDR length matching,
      coupling and timing are not approved.
    </p>
    <h2>Committed test result</h2>
    <img
      src={snapshotUrl}
      alt="Handheld routing test snapshot showing the result for this revision"
      style={{ width: "100%", maxWidth: 1120, height: "auto" }}
    />
    <h2>Fresh routing debugger</h2>
    <p>
      Run or step the solver below. It starts from the original pads and signal
      requests, without saved routes. The snapshot above is a recorded test
      result, not the live debugger state. A full solve can take several
      minutes.
    </p>
    <GenericSolverDebugger
      createSolver={() => {
        const input = structuredClone(fixture) as SimpleRouteJson
        input.allowedLayers = ["inner3"]
        return new SingleLayerConnectivitySolver(input, {
          gridStep: 0.1,
          maxPasses: 300,
          maxExpansionsPerRoute: 300000,
        })
      }}
    />
  </main>
)
