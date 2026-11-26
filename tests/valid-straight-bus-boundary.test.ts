import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { busLengthReports } from "../lib/route-lengths"
import type { SimpleRouteJson } from "../lib/types"

test("keeps an already valid bus when its straight channels have no tuning space", () => {
  // Board-world mm: +X right, +Y up. Each channel fits one 0.1 mm wire.
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0,
    allowedLayers: ["top"],
    bounds: { minX: 0, maxX: 12, minY: -0.05, maxY: 1.05 },
    obstacles: [
      {
        center: { x: 6, y: 0.5 },
        width: 12,
        height: 0.9,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: 1, y: 0, layer: "top" },
          { x: 11, y: 0, layer: "top" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 1, y: 1, layer: "top" },
          { x: 11.1, y: 1, layer: "top" },
        ],
      },
    ],
    buses: [
      { busId: "parallel", connectionNames: ["A", "B"], maxLengthSkew: 0.1 },
    ],
  }
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(2)
  expect(busLengthReports(input, solver.traces)[0].skewMm).toBeCloseTo(0.1, 12)
}, 10000)
