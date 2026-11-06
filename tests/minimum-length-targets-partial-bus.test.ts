import { expect, test } from "bun:test"
import { minimumLengthTargets } from "../lib/route-lengths"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("minimumLengthTargets relaxes skew constraints across the present subset of traces", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: 0, maxX: 30, minY: 0, maxY: 30 },
    obstacles: [],
    connections: [
      {
        name: "d0",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 0, layer: "top" },
        ],
      },
      {
        name: "d1",
        pointsToConnect: [
          { x: 0, y: 2, layer: "top" },
          { x: 20, y: 2, layer: "top" },
        ],
      },
      {
        name: "d2",
        pointsToConnect: [
          { x: 0, y: 4, layer: "top" },
          { x: 15, y: 4, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "byte0",
        connectionNames: ["d0", "d1", "d2"],
        maxLengthSkew: 1,
      },
    ],
  }

  const traces: Trace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_d0",
      connection_name: "d0",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 10, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_d1",
      connection_name: "d1",
      route: [
        { route_type: "wire", x: 0, y: 2, width: 0.1, layer: "top" },
        { route_type: "wire", x: 20, y: 2, width: 0.1, layer: "top" },
      ],
    },
  ]

  const targets = minimumLengthTargets(input, traces)
  expect(targets.get("d1")).toBeCloseTo(20, 6)
  expect(targets.get("d0")).toBeCloseTo(19, 6)
  expect(targets.has("d2")).toBe(false)
})
