import { expect, spyOn, test } from "bun:test"
import { matchNativeCarrierSignals } from "../lib/match-native-carrier-signals"
import { NativeCarrierRouter } from "../lib/native-carrier-router"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("fine native matching retains congestion learned by the coarse pass", () => {
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
          to_layer: "bottom",
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        { ...vias[0], route_type: "wire", layer: "inner1", width: 0.1 },
        { ...vias[1], route_type: "wire", layer: "inner1", width: 0.1 },
        {
          ...vias[1],
          route_type: "via",
          from_layer: "bottom",
          to_layer: "top",
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        { ...vias[1], route_type: "wire", layer: "top", width: 0.1 },
        { ...end, route_type: "wire", width: 0.1 },
      ],
    }
  })
  const before = structuredClone({ input, initial })
  const seen: Array<{
    step: number
    history: readonly Float32Array[]
    initialHistory: Float32Array[]
  }> = []
  const route = NativeCarrierRouter.prototype.route
  const observer = spyOn(
    NativeCarrierRouter.prototype,
    "route",
  ).mockImplementation(function (
    this: NativeCarrierRouter,
    connection,
    options,
  ) {
    seen.push({
      step: this.step,
      history: this.history,
      initialHistory: this.history.map((plane) => plane.slice()),
    })
    return route.call(this, connection, options)
  })
  const stages: string[] = []
  try {
    // A one-expansion budget keeps the real crossing seed in place, ensuring
    // the global pass learns congestion before handing it to local repair.
    const matching = matchNativeCarrierSignals(
      input,
      [],
      {
        gridStep: 0.2,
        fineGridStep: 0.1,
        maxPasses: 1,
        maxLocalPasses: 1,
        maxExpansionsPerRoute: 1,
      },
      (state) => stages.push(state.stage),
      initial,
    )
    let result = matching.next()
    while (!result.done) result = matching.next()
    expect(result.value).toBeNull()
  } finally {
    observer.mockRestore()
  }
  expect(stages).toContain("native_global_matching")
  expect(stages).toContain("native_local_matching_0")
  const coarse = seen.find((search) => search.step === 0.2)!
  expect(
    coarse.initialHistory.every((plane) => plane.every((value) => value === 0)),
  ).toBe(true)
  expect(coarse.history[1][10 + 10 * 21]).toBeGreaterThan(0)
  const fine = seen.find((search) => search.step === 0.1)!
  expect(fine).toBeDefined()
  expect(fine.initialHistory[0].every((value) => value === 0)).toBe(true)
  // The crossing is at board coordinate (0, 0), cell (20, 20) in the fine grid.
  expect(fine.initialHistory[1][20 + 20 * 41]).toBeGreaterThan(0)
  expect({ input, initial }).toEqual(before)
})
