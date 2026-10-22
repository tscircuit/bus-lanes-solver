import { expect, spyOn, test } from "bun:test"
import { matchNativeCarrierSignals } from "../lib/match-native-carrier-signals"
import { NativeCarrierRouter } from "../lib/native-carrier-router"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("native matching charges a crossing without penalizing clear distant copper", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -1.5, y: 0, layer: "top" },
          { x: 1.5, y: 0, layer: "top" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -1.5, layer: "top" },
          { x: 0, y: 1.5, layer: "top" },
        ],
      },
    ],
    obstacles: [],
  }
  input.obstacles = input.connections.flatMap((connection) =>
    connection.pointsToConnect.map((point, side) => ({
      type: "rect" as const,
      shape: "circle" as const,
      componentId: `${connection.name}_${side}`,
      center: { x: point.x, y: point.y },
      width: 0.3,
      height: 0.3,
      layers: ["top"],
      connectedTo: [connection.name],
    })),
  )
  const initial: Trace[] = input.connections.map((connection) => {
    const [start, end] = connection.pointsToConnect
    const vias = [start, end].map((point) => ({
      x: point.x / 1.5,
      y: point.y / 1.5,
    }))
    return {
      type: "pcb_trace",
      pcb_trace_id: connection.name,
      connection_name: connection.name,
      source_trace_id: connection.name,
      route: [
        { ...start, route_type: "wire", width: 0.1 },
        { ...vias[0], route_type: "wire", layer: "top", width: 0.1 },
        {
          ...vias[0],
          route_type: "via",
          from_layer: "top",
          to_layer: "inner1",
          layers: ["top", "inner1", "inner2", "bottom"],
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        { ...vias[0], route_type: "wire", layer: "inner1", width: 0.1 },
        { ...vias[1], route_type: "wire", layer: "inner1", width: 0.1 },
        {
          ...vias[1],
          route_type: "via",
          from_layer: "inner1",
          to_layer: "top",
          layers: ["top", "inner1", "inner2", "bottom"],
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        { ...vias[1], route_type: "wire", layer: "top", width: 0.1 },
        { ...end, route_type: "wire", width: 0.1 },
      ],
    }
  })
  const before = structuredClone({ input, initial })
  let router: NativeCarrierRouter | undefined
  const route = NativeCarrierRouter.prototype.route
  const observer = spyOn(
    NativeCarrierRouter.prototype,
    "route",
  ).mockImplementation(function (
    this: NativeCarrierRouter,
    connection,
    options,
  ) {
    router ??= this
    return route.call(this, connection, options)
  })
  try {
    // Keep the actual crossing proposals in place with a bounded real search.
    // Observe the congestion learned by that pass, before any local repair.
    const matching = matchNativeCarrierSignals(
      input,
      [],
      {
        gridStep: 0.1,
        maxPasses: 1,
        maxLocalPasses: 0,
        maxExpansionsPerRoute: 1,
      },
      undefined,
      initial,
    )
    let result = matching.next()
    while (!result.done) result = matching.next()
    expect(result.value).toBeNull()
  } finally {
    observer.mockRestore()
  }
  expect(router).toBeDefined()
  const at = (x: number, y: number) =>
    Math.round((y + 2) / 0.1) * 41 + Math.round((x + 2) / 0.1)
  expect(router!.history[1][at(0, 0)]).toBeGreaterThan(0)
  expect(router!.history[1][at(0.1, 0.1)]).toBeGreaterThan(0)
  // Both points are on one trace, 0.8 mm away from foreign copper.
  expect(router!.history[1][at(0.8, 0)]).toBe(0)
  expect(router!.history[1][at(0, 0.8)]).toBe(0)
  expect(router!.history[0].every((value) => value === 0)).toBe(true)
  expect({ input, initial }).toEqual(before)
})
