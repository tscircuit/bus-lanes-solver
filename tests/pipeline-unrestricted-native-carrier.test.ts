import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { SimpleRouteJson } from "../lib/types"

test("fresh escapes can use their native surface when global carrier layers are omitted", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.11,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [{
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.6,
      height: 11,
      layers: ["bottom"],
      connectedTo: [],
    }],
    connections: [{
      name: "DATA",
      pointsToConnect: [
        { x: -2.4, y: 0, layer: "top" },
        { x: 2.4, y: 0, layer: "top" },
      ],
    }],
  }
  for (const [componentId, x] of [["U1", -2.4], ["U2", 2.4]] as const) {
    for (let i = 0; i < 4; i++) input.obstacles.push({
      type: "rect",
      shape: "circle",
      componentId,
      center: { x: x + (i % 2) * 0.8, y: Math.floor(i / 2) * 0.8 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: i === 0 ? ["DATA"] : [],
    })
  }
  // Remote pads favor initial bottom approaches without obstructing the legal
  // top corridor. The bottom wall prevents every bottom-only continuation.
  for (let i = 0; i < 9; i++) input.obstacles.push({
    type: "rect",
    shape: "circle",
    componentId: "U3",
    center: { x: -4 + i * 0.3, y: 4 },
    width: 0.1,
    height: 0.1,
    layers: ["top"],
    connectedTo: [],
  })
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    denseSearch: true,
    smoothTuning: false,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  const output = solver.getOutput()
  expect(output.traces).toHaveLength(1)
  const trace = output.traces[0]
  expect(trace.connection_name).toBe("DATA")
  expect(trace.route[0]).toMatchObject(input.connections[0].pointsToConnect[0])
  expect(trace.route.at(-1)).toMatchObject(input.connections[0].pointsToConnect[1])
  expect(trace.route.every(point => point.route_type === "wire" && point.layer === "top")).toBe(true)
  expect(validateRoutedCopperDrc({
    inputSrj: input,
    routedSrj: output,
    clearance: 0.11,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0]).issues).toEqual([])
  expect(input).toEqual(before)
})
