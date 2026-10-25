import { BusLanesPipelineSolver } from "../lib"
import type { SimpleRouteJson } from "../lib"
import inputJson from "../tests/fixtures/native-smt-pair/input.json"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { pairLengthReports } from "../lib/route-lengths"
import { pairCouplingReports } from "../lib/pair-coupling"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { createTerminalViaClearanceChecker } from "../lib/terminal-via-clearance"

export function runNativeSmtPairCase(Solver = BusLanesPipelineSolver) {
  const input = structuredClone(inputJson) as unknown as SimpleRouteJson
  const before = JSON.stringify(input)
  const solver = new Solver(input, { maxSearchIterations: 2_000_000 })
  const started = performance.now()
  while (
    !solver.solved &&
    !solver.failed &&
    solver.iterations < 20_000 &&
    performance.now() - started < 60_000
  )
    solver.step()
  const traces = solver.solved ? solver.traces : []
  // Read-only DRC view: handoffs are via sites, while the original physical
  // terminals are the native pad anchors retained by the fixed fanout stubs.
  const physicalInput = {
    ...input,
    connections: input.connections.map((c) => ({
      ...c,
      pointsToConnect: c.pointsToConnect.map((p) => {
        const stub = input.traces?.find(
          (t) =>
            t.connection_name === c.name &&
            t.route.some(
              (q) =>
                q.route_type === "via" &&
                Math.hypot(q.x - p.x, q.y - p.y) < 1e-8,
            ),
        )
        return stub ? { ...p, ...stub.route[0] } : p
      }),
    })),
  }
  const report = {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    seconds: (performance.now() - started) / 1000,
    iterationBudget: 20_000,
    wallBudgetSeconds: 60,
    inputUnchanged: JSON.stringify(input) === before,
    carriers: traces.length,
    endpoints: input.connections.every((c) => {
      const t = traces.find((t) => t.connection_name === c.name)
      return (
        !!t &&
        [0, 1].every(
          (i) =>
            Math.hypot(
              t.route[i === 0 ? 0 : t.route.length - 1].x -
                c.pointsToConnect[i].x,
              t.route[i === 0 ? 0 : t.route.length - 1].y -
                c.pointsToConnect[i].y,
            ) < 1e-8,
        )
      )
    }),
    drc: validateRoutedCopperDrc({
      inputSrj: physicalInput,
      routedSrj: {
        ...physicalInput,
        traces: [...(input.traces ?? []), ...traces],
      },
      clearance: input.minTraceToPadEdgeClearance,
      allowBlindAndBuriedVias: false,
    }),
    pairs: pairLengthReports(input, traces),
    coupling: pairCouplingReports(input, traces),
    exterior: exteriorPairSpacingReports(input, traces),
    terminalViaShortcuts: traces
      .filter(
        (t) =>
          !createTerminalViaClearanceChecker(input, t, {
            preserveExistingApproach: false,
          })(t.route),
      )
      .map((t) => t.connection_name),
  }
  const accepted =
    report.solved &&
    report.inputUnchanged &&
    report.carriers === 2 &&
    report.endpoints &&
    report.drc.valid &&
    report.pairs.every((p) => p.matched) &&
    report.coupling.every((p) => p.matched) &&
    report.exterior.every((p) => p.matched) &&
    !report.terminalViaShortcuts.length
  return { input, traces, report: { ...report, accepted } }
}
