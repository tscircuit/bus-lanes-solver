import type { routeCoupledPair } from "../lib/coupled-pair-routing"
import { fixedCopper } from "../lib/vector-scene"
import { pairLengthReports } from "../lib/route-lengths"
import { pairCouplingReports } from "../lib/pair-coupling"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import inputJson from "../tests/fixtures/rotated-pair-handoff/input.json"
import type { SimpleRouteJson, Trace } from "../lib"

export function runRotatedPairHandoffCase(route: typeof routeCoupledPair) {
  const original = structuredClone(inputJson) as unknown as SimpleRouteJson
  // Equivalent board-world copper for orthogonally rotated rectangles. This
  // creates a second TEST INPUT; actual board output is never transformed.
  const normalized: SimpleRouteJson = {
    ...original,
    obstacles: original.obstacles.map((o) => {
      const angle = ((o.ccwRotationDegrees ?? 0) * Math.PI) / 180
      return {
        ...o,
        width:
          Math.abs(Math.cos(angle)) * o.width +
          Math.abs(Math.sin(angle)) * o.height,
        height:
          Math.abs(Math.sin(angle)) * o.width +
          Math.abs(Math.cos(angle)) * o.height,
        ccwRotationDegrees: 0,
      }
    }),
  }
  const cases = [original, normalized].map((input) => {
    const before = JSON.stringify(input),
      start = performance.now(),
      search = route(input, input.differentialPairs![0], fixedCopper(input))
    let state = search.next(),
      steps = 0
    while (
      !state.done &&
      steps < 2_000_000 &&
      performance.now() - start < 3_600_000
    ) {
      state = search.next()
      steps++
    }
    const traces: Trace[] = state.done ? (state.value ?? []) : []
    if (!state.done) search.return(null)
    const drc = validateRoutedCopperDrc({
        inputSrj: input,
        routedSrj: { ...input, traces },
        clearance:
          input.minTraceToPadEdgeClearance ??
          input.defaultObstacleMargin ??
          0.075,
        allowBlindAndBuriedVias: false,
      } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]),
      pairs = pairLengthReports(input, traces),
      coupling = pairCouplingReports(input, traces)
    return {
      traces,
      report: {
        solved: traces.length === 2,
        inputUnchanged: JSON.stringify(input) === before,
        steps,
        seconds: (performance.now() - start) / 1000,
        drc,
        pairs,
        coupling,
      },
    }
  })
  const geometryEqual =
    JSON.stringify(cases[0].traces) === JSON.stringify(cases[1].traces)
  const accepted =
    geometryEqual &&
    cases.every(
      (c) =>
        c.report.solved &&
        c.report.inputUnchanged &&
        c.report.drc.valid &&
        c.report.pairs.every((p) => p.matched) &&
        c.report.coupling.every((p) => p.matched),
    )
  return { input: original, cases, geometryEqual, accepted }
}
