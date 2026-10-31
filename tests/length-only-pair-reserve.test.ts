import { expect, test } from "bun:test"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { length } from "../lib/geometry"

test("length-only pairs keep their existing straight routes without a polygon reserve", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 10, minY: -1, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.089,
    minTraceToPadEdgeClearance: 0.089,
    obstacles: [],
    connections: [
      {
        name: "P",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 8, y: 0, layer: "top" },
        ],
      },
      {
        name: "N",
        pointsToConnect: [
          { x: 0, y: 0.5, layer: "top" },
          { x: 8.1, y: 0.5, layer: "top" },
        ],
      },
    ],
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance: 0.1 }],
  }
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  expect(solver.traces.map((trace) => trace.route.length)).toEqual([2, 2])
  expect(
    solver.traces.map((trace) => length(trace.route)).sort((a, b) => a - b),
  ).toEqual([8, 8.1])
  expect(solver.getOutput().differentialPairs).toEqual(
    original.differentialPairs,
  )
  expect(input).toEqual(original)
})
