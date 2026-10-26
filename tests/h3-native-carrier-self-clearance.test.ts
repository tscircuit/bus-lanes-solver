import { expect, test } from "bun:test"
import { nativeSignalGeometryIsValid } from "../lib/native-signal-geometry"
import type { SimpleRouteJson, Trace } from "../lib/types"
import { validateH3NativeCarrier } from "../scripts/validate-h3-native-carrier"

test("H3 artifact validation rejects a conventional same-net return loop", () => {
  const trace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "return-loop",
    connection_name: "DATA",
    route: [
      [0, 0],
      [1, 0],
      [2, 1],
      [2, 2],
      [1, 3],
      [0, 3],
      [-1, 2],
      [-1, 1],
      [0, 0],
      [1, 0],
    ].map(([x, y]) => ({
      route_type: "wire",
      x,
      y,
      layer: "top",
      width: 0.1143,
    })),
  }
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1143,
    minTraceToPadEdgeClearance: 0.0889,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    traces: [],
    connections: [
      {
        name: "DATA",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const validation = validateH3NativeCarrier({
    input,
    output: { ...input, traces: [trace] },
  })

  expect(nativeSignalGeometryIsValid(trace)).toBe(true)
  expect(validation.connectivity.valid).toBe(true)
  expect(validation.copperDrc.valid).toBe(true)
  expect(validation.routeQuality.issues).toEqual([
    { connectionName: "DATA", reason: "same-layer-self-clearance" },
  ])
  expect(validation.valid).toBe(false)
})
