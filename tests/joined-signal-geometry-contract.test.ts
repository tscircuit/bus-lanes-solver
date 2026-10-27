import { expect, test } from "bun:test"
import { joinedSignalGeometryIsValid } from "../lib/joined-signal-geometry"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("joined geometry preserves explicit unsmoothed corners but checks returning arms at maximum wire width", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.075,
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const corner: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "corner",
    connection_name: "DATA",
    route: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ].map((point) => ({
      ...point,
      route_type: "wire",
      layer: "top",
      width: 0.1,
    })),
  }
  expect(
    joinedSignalGeometryIsValid({ input, trace: corner, smoothTuning: true }),
  ).toBe(false)
  expect(
    joinedSignalGeometryIsValid({ input, trace: corner, smoothTuning: false }),
  ).toBe(true)
  const returning: Trace = {
    ...corner,
    route: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.25 },
      { x: 0, y: 0.25 },
    ].map((point, index) => ({
      ...point,
      route_type: "wire",
      layer: "top",
      width: index ? 0.3 : 0.1,
    })),
  }
  expect(
    joinedSignalGeometryIsValid({
      input,
      trace: returning,
      smoothTuning: false,
    }),
  ).toBe(false)
})
