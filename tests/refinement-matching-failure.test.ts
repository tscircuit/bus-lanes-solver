import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import type { Connection, SimpleRouteJson, Trace, Wire } from "../lib/types"

test("a failed refinement returns control without starting a new route search", () => {
  const connections: Connection[] = [
    {
      name: "DQ0",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 4, y: 0, layer: "top" },
      ],
    },
    {
      name: "DQ1",
      pointsToConnect: [
        { x: 0, y: 0.2, layer: "top" },
        { x: 2, y: 0.2, layer: "top" },
      ],
    },
  ]
  const traces: Trace[] = connections.map((connection) => ({
    type: "pcb_trace",
    pcb_trace_id: connection.name,
    connection_name: connection.name,
    route: connection.pointsToConnect.map(
      (point): Wire => ({ ...point, route_type: "wire", width: 0.1 }),
    ),
  }))
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -0.2, maxX: 4.2, minY: -0.2, maxY: 0.4 },
    connections,
    obstacles: [],
    buses: [
      {
        busId: "DDR_DATA",
        connectionNames: connections.map((connection) => connection.name),
        minLength: 1000,
      },
    ],
  }
  const original = structuredClone({ input, traces })
  const solver = BusLanesSolver.forRefinement(input, traces, {
    smoothTuning: true,
    denseSearch: true,
  })
  // Refinement callers choose their next topology after a matching failure.
  // This layout cannot fit the requested length inside its narrow board.
  solver.step()
  expect(solver.failed).toBe(true)
  expect(solver.failureCode).toBe("length_matching_failed")
  expect(solver.traces).toEqual(original.traces)
  expect({ input, traces }).toEqual(original)
  expect(() => solver.getOutput()).toThrow()
})
