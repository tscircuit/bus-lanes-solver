import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { SimpleRouteJson } from "../lib/types"

test("fixed via handoffs retain their other physical layers during lane negotiation", (): void => {
  const layers = ["top", "inner1", "inner2", "bottom"]
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.35,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 2,
        layers: ["inner1"],
        connectedTo: ["wall"],
      },
    ],
    connections: [
      {
        name: "data",
        pointsToConnect: [-1, 1].map((x) => ({
          x,
          y: 0,
          layer: "inner1",
          layers,
        })),
      },
    ],
    buses: [
      { busId: "data", connectionNames: ["data"], preferredLayer: "inner1" },
    ],
    traces: [-1, 1].map((x, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `fixed-escape-${index}`,
      connection_name: "data",
      isFixed: true,
      route: [
        { route_type: "wire", x, y: -0.4, layer: "top", width: 0.1 },
        { route_type: "wire", x, y: 0, layer: "top", width: 0.1 },
        {
          route_type: "via",
          x,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          via_diameter: 0.35,
          via_hole_diameter: 0.15,
        },
        { route_type: "wire", x, y: 0, layer: "inner1", width: 0.1 },
      ],
    })),
  }
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const points = solver.traces.flatMap((trace) => trace.route)
  expect(points.length).toBeGreaterThan(0)
  expect(
    points.every(
      (point) => point.route_type === "wire" && point.layer !== "inner1",
    ),
  ).toBeTrue()
  expect(input).toEqual(before)
})
