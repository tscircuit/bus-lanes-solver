import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { finishGeneratedSurfaceCarriers } from "../lib/finish-generated-surface-carriers"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { joinedSignalGeometryIsValid } from "../lib/joined-signal-geometry"
import { nativeSignalGeometryIsValid } from "../lib/native-signal-geometry"
import { retargetGeneratedEscape } from "../lib/retarget-generated-escape"
import { busLengthReports } from "../lib/route-lengths"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

test("shape the actual native ODT joins before whole-copper matching without touching supplied fanouts", () => {
  const carrier: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "ODT_carrier",
    connection_name: "ODT",
    route: [
      { x: -1.6, y: -7.2 },
      { x: -3.95, y: -9.55 },
      { x: -3.95, y: -27.45 },
      { x: -2.8, y: -28.6 },
    ].map((point) => ({
      ...point,
      route_type: "wire",
      layer: "top",
      width: 0.1,
    })),
  }
  const endpoints = [
    { x: -2, y: -6.8 },
    { x: -3.199892, y: -28.200023 },
  ]
  const escapes: Trace[] = endpoints.map((point, index) => {
    const handoff = carrier.route[index ? carrier.route.length - 1 : 0]
    return {
      type: "pcb_trace",
      pcb_trace_id: `approach_${index}`,
      connection_name: "ODT",
      route: [
        { ...point, route_type: "wire", layer: "top", width: 0.1 },
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
  })
  const supplied: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "approach_0",
    connection_name: "POWER",
    route: [
      { x: -5, y: -34 },
      { x: 5, y: -34 },
    ].map((point) => ({
      ...point,
      route_type: "wire",
      layer: "top",
      width: 0.1,
    })),
  }
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.075,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -8, maxX: 8, minY: -35, maxY: -4 },
    connections: [
      {
        name: "ODT",
        pointsToConnect: endpoints.map((point) => ({ ...point, layer: "top" })),
      },
    ],
    obstacles: endpoints.map((center) => ({
      shape: "circle",
      center,
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["ODT"],
    })),
    traces: [supplied],
    buses: [
      {
        busId: "ODT_LENGTH",
        connectionNames: ["ODT"],
        minLength: 30,
        maxLength: 31,
        maxLengthSkew: 0,
      },
    ],
  }
  const before = structuredClone({ input, carrier, escapes })
  const rejected = joinSignalEscapes(
    carrier,
    escapes.map((escape) => retargetGeneratedEscape(escape, "top")),
  )
  expect(nativeSignalGeometryIsValid(carrier)).toBe(true)
  expect(nativeSignalGeometryIsValid(rejected)).toBe(false)
  const finishing = finishGeneratedSurfaceCarriers({
    input,
    carriers: [carrier],
    escapes,
    options: { smoothTuning: true, denseSearch: true },
    maxSteps: 200000,
  })
  let state = finishing.next()
  while (!state.done) state = finishing.next()
  expect(state.value).not.toBeNull()
  if (!state.value)
    throw Error("Expected a complete shaped and matched native ODT route")
  const result = state.value
  expect(result.traces).toHaveLength(1)
  expect(joinedSignalGeometryIsValid({ input, trace: result.traces[0] })).toBe(
    true,
  )
  expect(result.traces[0].route[0]).toMatchObject(endpoints[0])
  expect(result.traces[0].route.at(-1)).toMatchObject(endpoints[1])
  expect(
    result.traces[0].route.every(
      (point) => point.route_type === "wire" && point.layer === "top",
    ),
  ).toBe(true)
  expect(result.escapes.every((escape) => escape.route.length === 1)).toBe(true)
  expect(result.input.traces![0]).toBe(supplied)
  const lengths = busLengthReports(input, result.traces)[0]
  expect(lengths.aboveMinimumLength).toBe(true)
  expect(lengths.withinLengthLimit).toBe(true)
  expect(lengths.matched).toBe(true)
  const drcInput = {
    ...input,
    connections: [
      ...input.connections,
      { name: "POWER", pointsToConnect: supplied.route as Wire[] },
    ],
  }
  expect(
    validateRoutedCopperDrc({
      inputSrj: drcInput,
      routedSrj: {
        ...drcInput,
        traces: [...input.traces!, ...result.traces],
      },
      clearance: 0.075,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0]).issues,
  ).toEqual([])
  expect({ input, carrier, escapes }).toEqual(before)
})
