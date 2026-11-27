import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { measureSignalPath } from "../lib/measure-signal-path"
import type { SimpleRouteJson, Terminal } from "../lib/types"

test("a branched clock routes from fixed fanout handoffs while measuring its original pads", (): void => {
  const from: Terminal = { x: 0, y: 0, layer: "top", pcb_port_id: "cpu-clock" }
  const to: Terminal = { x: 4, y: 0, layer: "top", pcb_port_id: "ram-clock" }
  const input: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.1, minViaPadDiameter: 0.35, minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 7, minY: -4, maxY: 4 }, obstacles: [],
    connections: [{ name: "clock", pointsToConnect: [
      { x: 0.5, y: 0, layer: "inner1", pointId: "cpu-handoff" },
      { x: 4.5, y: 0, layer: "inner1", pointId: "ram-handoff" },
      { x: 1, y: 2, layer: "bottom", pcb_port_id: "cpu-termination" },
      { x: 4, y: -2, layer: "bottom", pcb_port_id: "ram-termination" },
    ] }],
    buses: [{ busId: "clock", connectionNames: ["clock"], allowedLayers: ["top", "inner1", "inner2", "bottom"], preferredLayer: "inner1", lengthMatchingPaths: [{ connectionName: "clock", pcbPortIds: ["cpu-clock", "ram-clock"], from, to }] }],
    traces: [from, to].map((point, index) => ({
      type: "pcb_trace", pcb_trace_id: `fixed-escape-${index}`, connection_name: "clock", isFixed: true,
      route: [
        { route_type: "wire", x: point.x, y: point.y, layer: "top", width: 0.1 },
        { route_type: "wire", x: point.x + 0.5, y: point.y, layer: "top", width: 0.1 },
        { route_type: "via", x: point.x + 0.5, y: point.y, from_layer: "top", to_layer: "inner1", via_diameter: 0.35, via_hole_diameter: 0.15 },
        { route_type: "wire", x: point.x + 0.5, y: point.y, layer: "inner1", width: 0.1 },
      ],
    })),
  }
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  for (const terminal of input.connections[0].pointsToConnect) expect(measureSignalPath({ input, traces: [...input.traces!, ...solver.traces], connectionName: "clock", from, to: terminal })).not.toBeNull()
  expect(measureSignalPath({ input, traces: [...input.traces!, ...solver.traces], connectionName: "clock", from, to })).toBeGreaterThanOrEqual(5)
  expect(solver.traces.some((trace) => trace.pcb_trace_id.startsWith("fixed-escape"))).toBeFalse()
  expect(input).toEqual(before)
})
