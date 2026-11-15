import { expect, test } from "bun:test"
import { measureAm3352RoutingQuality } from "../scripts/measure-am3352-routing-quality"
import type { SimpleRouteJson, Trace } from "../lib"
test("benchmark rejects copper returning to its unchanged terminal via", () => {
  const wire = (x: number, y: number) => ({
    route_type: "wire" as const,
    x,
    y,
    layer: "inner1",
    width: 0.1,
  })
  const via = {
    route_type: "via" as const,
    x: 0,
    y: 0,
    from_layer: "top",
    to_layer: "inner1",
    layers: ["top", "inner1", "inner2", "bottom"],
    via_diameter: 0.5,
    via_hole_diameter: 0.3,
  }
  const trace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "P",
    connection_name: "P",
    route: [
      { ...wire(0, 0), layer: "top" },
      via,
      wire(0, 0),
      wire(1, 0),
      wire(1, 1),
      wire(0.1, 1),
      wire(0.1, 0.1),
      wire(-1, 0.1),
    ],
  }
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [],
    obstacles: [],
    traces: [],
  }
  expect(
    measureAm3352RoutingQuality(input, [trace]).terminalViaShortcuts,
  ).toEqual([{ connectionName: "P", clear: false }])
  expect(measureAm3352RoutingQuality(input, [trace]).issues).toContain(
    "P: signal shortcuts its terminal via land",
  )
  const clean = {
    ...trace,
    route: [
      { ...wire(0, 0), layer: "top" },
      via,
      wire(0, 0),
      wire(1, 0),
      wire(2, 1),
    ],
  }
  expect(
    measureAm3352RoutingQuality(input, [clean]).terminalViaShortcuts,
  ).toEqual([{ connectionName: "P", clear: true }])
})
