import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { length } from "../lib/geometry"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import type { SimpleRouteJson, Trace } from "../lib/types"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"

test("ordinary matching uses the available bank without relaxing copper clearance", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -0.1, maxX: 4.1, minY: -0.1, maxY: 0.65 },
    obstacles: [],
    connections: [
      {
        name: "DATA",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
    buses: [{ busId: "DATA", connectionNames: ["DATA"], minLength: 12 }],
  }
  const carrier: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "DATA",
    connection_name: "DATA",
    route: [
      { x: 0, y: 0, route_type: "wire", layer: "top", width: 0.1 },
      { x: 4, y: 0, route_type: "wire", layer: "top", width: 0.1 },
    ],
  }
  const original = structuredClone({ input, carrier })
  const solver = BusLanesSolver.forRefinement(input, [carrier], {
    smoothTuning: true,
  })
  solver.solve()
  expectCompletedRouting(solver, original.input)
  expect(length(solver.traces[0].route)).toBeCloseTo(12, 7)
  expect(tuningPathIsSelfClear(solver.traces[0].route, 0.2)).toBe(true)
  expect({ input, carrier }).toEqual(original)
})
