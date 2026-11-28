import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { busLengthReports, minimumLengthTargets } from "../lib/route-lengths"
import type { SimpleRouteJson, Trace } from "../lib/types"

function plainCrossedBus(maxLengthSkew: number): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.15,
    defaultObstacleMargin: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -5, maxY: 5 },
    connections: [
      {
        name: "source_trace_0",
        pointsToConnect: [
          { x: -3.5, y: -1.27, layer: "top" },
          { x: 4, y: 1.27, layer: "bottom", layers: ["top", "bottom"] },
        ],
      },
      {
        name: "source_trace_1",
        pointsToConnect: [
          { x: -3.5, y: 1.27, layer: "top" },
          { x: 4, y: -1.27, layer: "bottom", layers: ["top", "bottom"] },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -4.5, y: -1.27 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["R1.1"],
      },
      {
        type: "rect",
        center: { x: -3.5, y: -1.27 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["source_trace_0"],
      },
      {
        type: "rect",
        center: { x: -4.5, y: 1.27 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["R2.1"],
      },
      {
        type: "rect",
        center: { x: -3.5, y: 1.27 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["source_trace_1"],
      },
      {
        type: "rect",
        shape: "circle",
        center: { x: 4, y: -1.27 },
        width: 1.5,
        height: 1.5,
        layers: ["top", "bottom"],
        connectedTo: ["source_trace_1"],
      },
      {
        type: "rect",
        shape: "circle",
        center: { x: 4, y: 1.27 },
        width: 1.5,
        height: 1.5,
        layers: ["top", "bottom"],
        connectedTo: ["source_trace_0"],
      },
    ],
    buses: [
      {
        busId: "DATA",
        connectionNames: ["source_trace_0", "source_trace_1"],
        maxLengthSkew,
        traceWidth: 0.15,
      },
    ],
  }
}

test.each([0.1, 0.1001, 0.05])(
  "plain tuned bus stays within maxLengthSkew=%s after envelope compaction",
  (maxLengthSkew) => {
    const input = plainCrossedBus(maxLengthSkew)
    const solver = new BusLanesPipelineSolver(input)
    solver.solve()
    expect(solver.solved).toBe(true)
    const report = busLengthReports(input, solver.traces)[0]
    expect(report.matched).toBe(true)
    expect(report.skewMm).not.toBeNull()
    expect(report.skewMm!).toBeLessThanOrEqual(maxLengthSkew)
  },
)

test("minimumLengthTargets reserves roundoff only for lanes that require tuning", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    defaultObstacleMargin: 0.1,
    bounds: { minX: 0, maxX: 20, minY: 0, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "short_tuned",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 9, y: 0, layer: "top" },
        ],
      },
      {
        name: "boundary_ok",
        pointsToConnect: [
          { x: 0, y: 1, layer: "top" },
          { x: 9.9, y: 1, layer: "top" },
        ],
      },
      {
        name: "ceiling",
        pointsToConnect: [
          { x: 0, y: 2, layer: "top" },
          { x: 10, y: 2, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "DATA",
        connectionNames: ["short_tuned", "boundary_ok", "ceiling"],
        maxLengthSkew: 0.1,
      },
    ],
  }
  const traces: Trace[] = input.connections.map((c) => ({
    type: "pcb_trace",
    pcb_trace_id: c.name,
    connection_name: c.name,
    route: c.pointsToConnect.map((p) => ({
      ...p,
      route_type: "wire" as const,
      width: 0.15,
    })),
  }))
  const targets = minimumLengthTargets(input, traces)
  expect(targets.get("boundary_ok")).toBe(9.9)
  expect(targets.get("ceiling")).toBe(10)
  expect(targets.get("short_tuned")).toBeCloseTo(9.9 + 1e-8, 12)
})
