import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { finishGeneratedSurfaceCarriers } from "../lib/finish-generated-surface-carriers"
import { joinedSignalGeometryIsValid } from "../lib/joined-signal-geometry"
import { pairLengthReports } from "../lib/route-lengths"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("repair both native joins of a length-only pair and match complete copper without inventing coupling", () => {
  const names: [string, string] = ["STROBE_P", "STROBE_N"]
  const carriers: Trace[] = names.map((connection_name, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `${connection_name}_carrier`,
    connection_name,
    route: [
      { x: -1.6, y: -7.2 },
      { x: -3.95, y: -9.55 },
      { x: -3.95, y: -27.45 },
      { x: -2.8, y: -28.6 },
    ].map((point) => ({
      ...point,
      x: point.x + 5 * index,
      route_type: "wire",
      layer: "top",
      width: 0.1,
    })),
  }))
  const connections = names.map((name, index) => ({
    name,
    pointsToConnect: [
      { x: -2 + 5 * index, y: -6.8, layer: "top" },
      { x: -3.199892 + 5 * index, y: -28.200023, layer: "top" },
    ],
  }))
  const escapes: Trace[] = connections.flatMap((connection, index) =>
    connection.pointsToConnect.map((point, end) => {
      const carrier = carriers[index]
      const handoff = carrier.route[end ? carrier.route.length - 1 : 0]
      return {
        type: "pcb_trace",
        pcb_trace_id: `${connection.name}_approach_${end}`,
        connection_name: connection.name,
        route: [
          { ...point, route_type: "wire", width: 0.1 },
          { ...handoff, route_type: "wire", layer: "top", width: 0.1 },
          {
            ...handoff,
            route_type: "via",
            from_layer: "top",
            to_layer: "bottom",
            layers: ["top", "inner1", "inner2", "bottom"],
            via_diameter: 0.3,
            via_hole_diameter: 0.15,
          },
          { ...handoff, route_type: "wire", layer: "bottom", width: 0.1 },
        ],
      }
    }),
  )
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.075,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -8, maxX: 8, minY: -35, maxY: -4 },
    connections,
    obstacles: connections.flatMap((connection) =>
      connection.pointsToConnect.map((center) => ({
        shape: "circle",
        center,
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: [connection.name],
      })),
    ),
    differentialPairs: [{ connectionNames: names, lengthTolerance: 0.127 }],
  }
  const before = structuredClone({ input, carriers, escapes })
  const finishing = finishGeneratedSurfaceCarriers({
    input,
    carriers,
    escapes,
    options: { smoothTuning: true, denseSearch: true },
    maxSteps: 200000,
  })
  let state = finishing.next()
  while (!state.done) state = finishing.next()
  expect(state.value).not.toBeNull()
  if (!state.value) throw Error("Expected complete native length-only pair")
  const result = state.value
  expect(result.traces).toHaveLength(2)
  expect(
    result.traces.every((trace) =>
      joinedSignalGeometryIsValid({ input, trace }),
    ),
  ).toBe(true)
  expect(result.traces.every((trace) => !trace.coupledSection)).toBe(true)
  expect(pairLengthReports(input, result.traces)[0].matched).toBe(true)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: result.traces },
      clearance: 0.075,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0]).issues,
  ).toEqual([])
  expect({ input, carriers, escapes }).toEqual(before)
})
