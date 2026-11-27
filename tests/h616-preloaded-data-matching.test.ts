import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { busLengthReports } from "../lib/route-lengths"
import type { SimpleRouteJson } from "../lib/types"

// Original Core DDR phase, in board-world mm (+X right, +Y up).
test("routes and length-matches both H616 data bytes around fixed fanouts", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(gunzipSync(readFileSync(new URL(
    "./fixtures/h616-preloaded-data.srj.json.gz", import.meta.url,
  ))).toString())
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(input).toEqual(original)
  if (solver.solved) {
    expect(solver.traces).toHaveLength(22)
    expect(busLengthReports(input, solver.traces).every((report) =>
      (report.toleranceMm === null || report.matched) &&
      report.withinLengthLimit && report.aboveMinimumLength,
    )).toBeTrue()
    expect(solver.getOutput().traces.slice(0, input.traces!.length)).toEqual(input.traces!)
    expect(validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...solver.getOutput(), traces: solver.traces },
      clearance: input.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0]).issues).toEqual([])
  }
  // Failed baselines show supplied copper only, never an unaccepted candidate.
  const traces = solver.solved ? solver.getOutput().traces : original.traces
  const graphics = new BusLanesSolver({ ...original, traces }).visualize()
  graphics.viewbox = { minX: -11, maxX: 13, minY: 1, maxY: 21 }
  graphics.texts = [{ x: -10.5, y: 20.5, fontSize: 0.45, anchorSide: "bottom_left",
    text: solver.solved
      ? "H616 data: 22/22 routed; skew passed; fixed copper preserved"
      : "FAILED: no accepted data routing; supplied fanouts and clocks only",
  }]
  await expect(getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white", svgWidth: 1200, svgHeight: 1000,
    includeTextLabels: false, hideInlineLabels: true,
  })).toMatchSvgSnapshot(import.meta.path)
  expect(solver.solved, solver.error ?? undefined).toBeTrue()
})
