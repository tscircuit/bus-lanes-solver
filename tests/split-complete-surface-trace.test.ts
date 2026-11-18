import { retargetGeneratedEscape } from "../lib/retarget-generated-escape"
import { test, expect } from "bun:test"
import { splitCompleteSurfaceTrace } from "../lib/split-complete-surface-trace"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import type { Trace, Wire } from "../lib/types"
const wire = (x: number, layer: string): Wire => ({
  x,
  y: 0,
  layer,
  width: 0.1143,
  route_type: "wire",
})
function complete(vias: number): Trace {
  const route: Trace["route"] = [wire(-3, "top"), wire(-2, "top")]
  let layer = "top"
  for (let index = 0; index < vias; index++) {
    const x = index - 2,
      next = layer === "top" ? "bottom" : "top"
    if (index) route.push(wire(x, layer))
    route.push(
      {
        route_type: "via",
        x,
        y: 0,
        from_layer: layer,
        to_layer: next,
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.425 + index * 0.01,
        via_hole_diameter: 0.175 + index * 0.005,
      },
      wire(x, next),
    )
    layer = next
  }
  route.push(wire(vias ? vias - 1 : -1, layer))
  return {
    type: "pcb_trace",
    pcb_trace_id: "current_seed",
    connection_name: "DATA",
    source_trace_id: "source_trace_DATA",
    route,
  }
}
function shape(trace: Trace) {
  return {
    route: trace.route,
    curvedSegments: trace.curvedSegments?.length
      ? trace.curvedSegments
      : undefined,
    coupledSection: trace.coupledSection,
  }
}
function reverse(trace: Trace): Trace {
  return {
    ...structuredClone(trace),
    route: trace.route
      .toReversed()
      .map((point) =>
        point.route_type === "via"
          ? { ...point, from_layer: point.to_layer, to_layer: point.from_layer }
          : structuredClone(point),
      ),
    curvedSegments: trace.curvedSegments
      ?.map((index) => trace.route.length - index)
      .sort((a, b) => a - b),
    coupledSection: trace.coupledSection
      ? [
          trace.route.length - 1 - trace.coupledSection[1],
          trace.route.length - 1 - trace.coupledSection[0],
        ]
      : undefined,
  }
}
for (const viaCount of [0, 2, 4, 6])
  for (const reversed of [false, true])
    test(`split/join retains every physical point for ${viaCount} vias, reversed=${reversed}`, () => {
      const trace = reversed ? reverse(complete(viaCount)) : complete(viaCount),
        original = structuredClone(trace)
      const result = splitCompleteSurfaceTrace(trace)
      expect(result.carrier.route.length).toBeGreaterThan(1)
      expect(
        result.carrier.route.every(
          (point) =>
            point.route_type === "wire" &&
            point.layer === (result.carrier.route[0] as Wire).layer,
        ),
      ).toBe(true)
      expect(shape(joinSignalEscapes(result.carrier, result.escapes))).toEqual(
        shape(trace),
      )
      expect(trace).toEqual(original)
      if (viaCount) {
        expect(result.escapes).toHaveLength(2)
        expect(
          result.escapes[1].route.filter((point) => point.route_type === "via"),
        ).toHaveLength(viaCount - 1)
      } else expect(result.escapes).toEqual([])
      const mutable = result.carrier.route[0]
      mutable.x += 3
      expect(trace).toEqual(original)
    })
test("curve chord indexes round-trip across source, carrier and reversed target approach", () => {
  const trace = complete(6)
  trace.curvedSegments = trace.route.flatMap((point, index) =>
    index &&
    point.route_type === "wire" &&
    trace.route[index - 1].route_type === "wire"
      ? [index]
      : [],
  )
  for (const current of [trace, reverse(trace)]) {
    const original = structuredClone(current),
      result = splitCompleteSurfaceTrace(current)
    expect(result.escapes[0].curvedSegments?.length).toBeGreaterThan(0)
    expect(result.carrier.curvedSegments?.length).toBeGreaterThan(0)
    expect(result.escapes[1].curvedSegments?.length).toBeGreaterThan(0)
    expect(shape(joinSignalEscapes(result.carrier, result.escapes))).toEqual(
      shape(current),
    )
    expect(current).toEqual(original)
  }
})
for (const range of [
  [0, 1],
  [3, 4],
  [6, 7],
] as [number, number][])
  test(`coupled section ${range} stays on its actual planar run`, () => {
    const trace = complete(4)
    trace.coupledSection = range
    for (const current of [trace, reverse(trace)]) {
      const result = splitCompleteSurfaceTrace(current)
      expect(shape(joinSignalEscapes(result.carrier, result.escapes))).toEqual(
        shape(current),
      )
      const section = result.carrier.coupledSection!
      expect(section[0]).toBeGreaterThanOrEqual(0)
      expect(section[1]).toBeLessThan(result.carrier.route.length)
    }
  })
test("explicit physical layers and each manufactured land/drill are copied, not re-derived", () => {
  const trace = complete(4),
    result = splitCompleteSurfaceTrace(trace)
  expect(
    joinSignalEscapes(result.carrier, result.escapes).route.filter(
      (point) => point.route_type === "via",
    ),
  ).toEqual(trace.route.filter((point) => point.route_type === "via"))
  const returnedVia = result.escapes[0].route.find(
    (point) => point.route_type === "via",
  )!
  if (returnedVia.route_type === "via") returnedVia.layers!.push("mutated")
  expect(
    trace.route
      .filter((point) => point.route_type === "via")
      .every((point) => !point.layers!.includes("mutated")),
  ).toBe(true)
})
test("carrier layer restrictions select an actual permitted run without altering copper", () => {
  const trace = complete(4),
    result = splitCompleteSurfaceTrace(trace, { carrierLayers: ["top"] })
  expect((result.carrier.route[0] as Wire).layer).toBe("top")
  expect(shape(joinSignalEscapes(result.carrier, result.escapes))).toEqual(
    shape(trace),
  )
  expect(() =>
    splitCompleteSurfaceTrace(trace, { carrierLayers: ["inner1"] }),
  ).toThrow("no planar carrier")
})
test("approach identifiers are unique and the caller's known identifier set is immutable", () => {
  const trace = complete(2),
    ids = new Set([
      trace.pcb_trace_id,
      "current_seed_source_approach",
      "current_seed_target_approach",
      "current_seed_target_approach_1",
    ]),
    before = [...ids]
  const result = splitCompleteSurfaceTrace(trace, { usedTraceIds: ids })
  expect(
    new Set([
      result.carrier.pcb_trace_id,
      ...result.escapes.map((escape) => escape.pcb_trace_id),
    ]).size,
  ).toBe(3)
  expect(result.escapes.every((escape) => !ids.has(escape.pcb_trace_id))).toBe(
    true,
  )
  expect([...ids]).toEqual(before)
})
test("invalid transitions and metadata cannot be silently dropped or shifted across barrels", () => {
  const mutations: Array<(trace: Trace) => void> = [
    (trace) => {
      trace.route[3].x += 0.01
    },
    (trace) => {
      ;(trace.route[0] as Wire).layer = "inner1"
    },
    (trace) => {
      trace.coupledSection = [1, 4]
    },
    (trace) => {
      trace.curvedSegments = [2]
    },
    (trace) => {
      trace.route[1].x = NaN
    },
  ]
  for (const mutate of mutations) {
    const trace = complete(2)
    mutate(trace)
    const original = structuredClone(trace)
    expect(() => splitCompleteSurfaceTrace(trace)).toThrow()
    expect(trace).toEqual(original)
  }
})

test("a same-layer logical barrel is rejected before actual escape retargeting could erase it", () => {
  const trace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "same_layer_barrel",
    connection_name: "DATA",
    route: [
      wire(-2, "top"),
      wire(-1, "top"),
      {
        route_type: "via",
        x: -1,
        y: 0,
        from_layer: "top",
        to_layer: "top",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.45,
        via_hole_diameter: 0.2,
      },
      wire(-1, "top"),
      wire(0, "top"),
    ],
  }
  const original = structuredClone(trace)
  const retargeted = retargetGeneratedEscape(structuredClone(trace), "top")
  expect(
    retargeted.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(0)
  expect(() => splitCompleteSurfaceTrace(trace)).toThrow(
    "must change its logical routing layer",
  )
  expect(trace).toEqual(original)
})
