import { expect, test } from "bun:test"
import {
  canonicalConnectivityTrace,
  connectivityDrillConflicts,
  connectivityViaShortcuts,
} from "../lib/connectivity-geometry"
import type { SimpleRouteJson, Trace, Wire, Via } from "../lib/types"
const wire = (x: number, y: number, layer = "top"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})
const via = (x: number, y: number): Via => ({
  route_type: "via",
  x,
  y,
  from_layer: "top",
  to_layer: "inner1",
  via_diameter: 0.25,
  via_hole_diameter: 0.15,
})
const trace = (name: string, route: Trace["route"]): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: name,
  connection_name: name,
  route,
})
const input: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.1,
  minViaHoleDiameter: 0.15,
  minViaHoleEdgeToViaHoleEdgeClearance: 0.25,
  bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
  connections: [],
  obstacles: [],
}

test("drill clearance catches same-net and different-net holes independently of copper lands", () => {
  for (const offset of [0, 7.25]) {
    const a = trace("arbitrary-a", [via(offset, 0)])
    const b = trace("arbitrary-b", [via(offset + 0.36, 0)])
    expect(connectivityDrillConflicts(input, [a, b])).toHaveLength(1)
    expect(
      connectivityDrillConflicts(input, [
        trace("same", [...a.route, ...b.route]),
      ]),
    ).toHaveLength(1)
    b.route[0].x = offset + 0.4
    expect(connectivityDrillConflicts(input, [a, b])).toHaveLength(0)
  }
})
test("owned pad normalization removes false path length while preserving endpoints and caller data", () => {
  for (const offset of [0, -4.5]) {
    const c = {
      name: "renamed",
      pointsToConnect: [
        { x: offset, y: 0, layer: "top", pcb_port_id: "start" },
        { x: offset + 4, y: 0, layer: "top", pcb_port_id: "end" },
      ],
    }
    const f = {
      ...input,
      connections: [c],
      obstacles: [
        {
          shape: "circle" as const,
          componentId: "device",
          center: { x: offset, y: 0 },
          width: 0.3,
          height: 0.3,
          layers: ["top"],
          connectedTo: ["start"],
        },
      ],
    }
    const t = trace(c.name, [
      wire(offset, 0),
      wire(offset, 0.2),
      wire(offset + 0.2, 0.2),
      wire(offset + 0.2, 0),
      via(offset + 0.2, 0),
      wire(offset + 0.2, 0, "inner1"),
      wire(offset + 4, 0, "inner1"),
      { ...via(offset + 4, 0), from_layer: "inner1", to_layer: "top" },
      wire(offset + 4, 0),
    ])
    const before = structuredClone(t)
    const result = canonicalConnectivityTrace(f, c, t)
    expect(t).toEqual(before)
    expect(result.route[0]).toEqual(t.route[0])
    expect(result.route.at(-1)).toEqual(t.route.at(-1))
    expect(result.route.slice(0, 3)).toEqual([
      wire(offset, 0),
      wire(offset + 0.2, 0),
      via(offset + 0.2, 0),
    ])
  }
})
test("zero-length via excursion is removed without introducing a layer jump", () => {
  const c = {
    name: "loop",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 2, y: 0, layer: "top" },
    ],
  }
  const t = trace("loop", [
    wire(0, 0),
    wire(1, 0),
    via(1, 0),
    wire(1, 0, "inner1"),
    { ...via(1, 0), from_layer: "inner1", to_layer: "top" },
    wire(1, 0),
    wire(2, 0),
  ])
  expect(canonicalConnectivityTrace(input, c, t).route).toEqual([
    wire(0, 0),
    wire(1, 0),
    wire(2, 0),
  ])
})
test("nonlocal via contact is rejected but a local handoff remains valid", () => {
  const clean = trace("test", [
    wire(0, 0),
    via(0, 0),
    wire(0, 0, "inner1"),
    wire(2, 0, "inner1"),
  ])
  expect(connectivityViaShortcuts(input, clean)).toBe(false)
  const loop = trace("test", [
    ...clean.route,
    wire(2, 1, "inner1"),
    wire(0, 1, "inner1"),
    wire(0, 0.05, "inner1"),
  ])
  expect(connectivityViaShortcuts(input, loop)).toBe(true)
})
