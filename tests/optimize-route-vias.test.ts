import { expect, test } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { optimizeRouteVias, type RouteViaOptimizationOptions } from "../lib"
import type {
  Connection,
  SimpleRouteJson,
  Trace,
  Via,
  Wire,
} from "../lib/types"
import { nativeValidationSrj } from "./fixtures/expect-completed-routing"

const wire = (x: number, y: number, layer = "top"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.15,
})

const via = (x: number, from_layer: string, to_layer: string): Via => ({
  route_type: "via",
  x,
  y: 0,
  from_layer,
  to_layer,
  via_diameter: 0.3,
  via_hole_diameter: 0.15,
})

function testRoute(endLayer: string) {
  const start = { ...wire(0, 0), start_pcb_port_id: "signal_a" }
  const end = { ...wire(10, 0, endLayer), end_pcb_port_id: "signal_b" }
  const route: Trace["route"] = [
    start,
    wire(2, 0),
    via(2, "top", "bottom"),
    wire(2, 0, "bottom"),
    wire(4, 0, "bottom"),
    via(4, "bottom", "top"),
    wire(4, 0),
    wire(6, 0),
    via(6, "top", "bottom"),
    wire(6, 0, "bottom"),
    ...(endLayer === "top"
      ? [wire(8, 0, "bottom"), via(8, "bottom", "top"), wire(8, 0)]
      : []),
    end,
  ]
  const signal: Connection = {
    name: "signal",
    pointsToConnect: [
      { x: start.x, y: start.y, layer: start.layer, pcb_port_id: "signal_a" },
      { x: end.x, y: end.y, layer: end.layer, pcb_port_id: "signal_b" },
    ],
  }
  return {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -1, maxX: 11, minY: -3, maxY: 3 },
    connections: [signal],
    obstacles: [
      {
        center: { x: 3, y: 0 },
        width: 0.8,
        height: 0.8,
        layers: ["top"],
        connectedTo: [],
      },
      {
        center: { x: 5, y: 0 },
        width: 0.8,
        height: 0.8,
        layers: ["bottom"],
        connectedTo: [],
      },
    ],
    traces: [
      {
        type: "pcb_trace" as const,
        connection_name: "signal",
        pcb_trace_id: "signal",
        route,
      },
    ],
  } satisfies SimpleRouteJson
}

function validator(
  input: SimpleRouteJson,
): RouteViaOptimizationOptions["validate"] {
  const inputSrj = nativeValidationSrj(input)
  return (traces) => {
    const routedSrj = nativeValidationSrj({ ...input, traces: [...traces] })
    return (
      validateOriginalEndpointConnectivity({ inputSrj, routedSrj }).valid &&
      validateRoutedCopperDrc({ inputSrj, routedSrj, clearance: 0.1 }).valid
    )
  }
}

test("uses one planar span to bypass four vias and preserves terminal attachments", () => {
  const input = testRoute("top")
  const original = structuredClone(input)
  const result = optimizeRouteVias(input, { validate: validator(input) })
  expect(
    result[0].route.filter((point) => point.route_type === "via"),
  ).toHaveLength(0)
  expect(result[0].route[0]).toEqual(input.traces[0].route[0])
  expect(result[0].route.at(-1)).toEqual(input.traces[0].route.at(-1))
  expect(validator(input)(result)).toBe(true)
  expect(input).toEqual(original)
  expect(optimizeRouteVias(input, { validate: validator(input) })).toEqual(
    result,
  )
})

test("uses one of the original drilled sites when the endpoints are on different layers", () => {
  const input = testRoute("bottom")
  const result = optimizeRouteVias(input, { validate: validator(input) })
  const vias = result[0].route.filter((point) => point.route_type === "via")
  expect(vias).toHaveLength(1)
  expect(input.traces[0].route).toContainEqual(vias[0])
  expect(validator(input)(result)).toBe(true)
})

test("honors the board audit and routes marked fixed or length constrained", () => {
  const input = testRoute("top")
  let candidateChecks = 0
  const result = optimizeRouteVias(input, {
    validate: (traces) => {
      candidateChecks++
      return traces === input.traces
    },
  })
  expect(candidateChecks).toBeGreaterThan(1)
  expect(result).toEqual(input.traces)

  const fixed = {
    ...input,
    traces: input.traces.map((trace) => ({ ...trace, isFixed: true })),
  }
  expect(optimizeRouteVias(fixed, { validate: validator(fixed) })).toEqual(
    fixed.traces,
  )

  const constrained = {
    ...input,
    buses: [{ busId: "timed", connectionNames: ["signal"], minLength: 10 }],
  }
  expect(
    optimizeRouteVias(constrained, { validate: validator(constrained) }),
  ).toEqual(constrained.traces)
})
