import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { length } from "../lib/geometry"
import { matchNativeCarrierSignals } from "../lib/match-native-carrier-signals"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import type { SimpleRouteJson, Trace } from "../lib/types"

function fixture() {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 3 },
    obstacles: [],
    connections: ["P", "N", "DATA"].map((name, index) => ({
      name,
      source_trace_id: name,
      pointsToConnect: [
        { x: index === 2 ? -1.7 : -1.5, y: [1, 1.5, 0][index], layer: "top" },
        { x: index === 2 ? 1.7 : 1.5, y: [1, 1.5, 0][index], layer: "top" },
      ],
    })),
    buses: [
      {
        busId: "DATA_BUS",
        connectionNames: ["P", "N", "DATA"],
        maxLengthSkew: 0.5,
        maxLength: 3.5,
      },
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], lengthTolerance: 0.01, traceGap: 0.4 },
    ],
  }
  input.obstacles = input.connections.flatMap((connection) =>
    connection.pointsToConnect.map((point, side) => ({
      componentId: `U${side}`,
      shape: "circle" as const,
      center: { x: point.x, y: point.y },
      width: 0.3,
      height: 0.3,
      layers: ["top"],
      connectedTo: [connection.name],
    })),
  )
  const paired: Trace[] = input.connections.slice(0, 2).map((connection) => {
    const [start, end] = connection.pointsToConnect
    const wire = (x: number, layer: string) => ({
      x,
      y: start.y,
      route_type: "wire" as const,
      layer,
      width: 0.1,
    })
    const via = (x: number, from: string, to: string) => ({
      x,
      y: start.y,
      route_type: "via" as const,
      from_layer: from,
      to_layer: to,
      layers: ["top", "inner1", "inner2", "bottom"],
      via_diameter: 0.3,
      via_hole_diameter: 0.15,
    })
    return {
      type: "pcb_trace",
      pcb_trace_id: connection.name,
      connection_name: connection.name,
      source_trace_id: connection.name,
      coupledSection: [3, 4],
      route: [
        wire(start.x, "top"),
        wire(-1, "top"),
        via(-1, "top", "inner1"),
        wire(-1, "inner1"),
        wire(1, "inner1"),
        via(1, "inner1", "top"),
        wire(1, "top"),
        wire(end.x, "top"),
      ],
    }
  })
  return { input, paired }
}

function match(input: SimpleRouteJson, paired: Trace[]) {
  const search = matchNativeCarrierSignals(input, paired, {
    gridStep: 0.1,
    maxPasses: 4,
    maxLocalPasses: 1,
    maxExpansionsPerRoute: 100000,
  })
  let result = search.next()
  while (!result.done) result = search.next()
  return result.value
}

function scaleFixture(input: SimpleRouteJson, paired: Trace[]) {
  for (const connection of input.connections)
    for (const point of connection.pointsToConnect) {
      point.x *= 3
      point.y *= 3
    }
  for (const obstacle of input.obstacles) {
    obstacle.center.x *= 3
    obstacle.center.y *= 3
  }
  for (const trace of paired)
    for (const point of trace.route) {
      point.x *= 3
      point.y *= 3
    }
  input.bounds = { minX: -9, maxX: 9, minY: -6, maxY: 9 }
  input.buses![0].maxLength = 10.5
  input.buses![0].maxLengthSkew = 1.5
  input.differentialPairs![0].traceGap = 1.4
}

test("native data may be longer than its fixed pair within the declared bus skew", () => {
  const { input, paired } = fixture()
  const before = structuredClone({ input, paired })
  const traces = match(input, paired)
  expect(traces).not.toBeNull()
  expect(traces).toHaveLength(3)
  expect(traces!.slice(0, 2)).toEqual(paired)
  const data = traces!.find((trace) => trace.connection_name === "DATA")!
  expect(length(data.route)).toBeCloseTo(3.4, 8)
  expect(data.route.filter((point) => point.route_type === "via")).toHaveLength(
    2,
  )
  const [bus] = busLengthReports(input, traces!)
  expect(bus.matched).toBe(true)
  expect(bus.withinLengthLimit).toBe(true)
  expect(bus.skewMm).toBeCloseTo(0.4, 8)
  expect(pairLengthReports(input, traces!)[0].matched).toBe(true)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: traces! },
      clearance: 0.1,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  expect({ input, paired }).toEqual(before)
})

for (const constraint of ["absolute maximum", "bus skew", "zero skew"] as const)
  test(`native anchor window still enforces ${constraint}`, () => {
    const { input, paired } = fixture()
    if (constraint === "absolute maximum") input.buses![0].maxLength = 3.3
    else input.buses![0].maxLengthSkew = constraint === "zero skew" ? 0 : 0.3
    const before = structuredClone({ input, paired })
    expect(match(input, paired)).toBeNull()
    expect({ input, paired }).toEqual(before)
  })

test("a bus with only absolute bounds does not require equality with its pair", () => {
  const { input, paired } = fixture()
  delete input.buses![0].maxLengthSkew
  input.buses![0].minLength = 2.9
  const before = structuredClone({ input, paired })
  const traces = match(input, paired)
  expect(traces).not.toBeNull()
  const [bus] = busLengthReports(input, traces!)
  expect(bus.aboveMinimumLength).toBe(true)
  expect(bus.withinLengthLimit).toBe(true)
  expect(traces!.slice(0, 2)).toEqual(paired)
  expect({ input, paired }).toEqual(before)
})

test("ordinary members on both sides of the fixed pair still match the complete bus", () => {
  const { input, paired } = fixture()
  for (const point of input.connections[2].pointsToConnect) point.x *= 1.3 / 1.7
  input.obstacles = input.obstacles.filter(
    (obstacle) => !obstacle.connectedTo.includes("DATA"),
  )
  const longer = {
    name: "LONGER",
    source_trace_id: "LONGER",
    pointsToConnect: [
      { x: -1.7, y: -1, layer: "top" },
      { x: 1.7, y: -1, layer: "top" },
    ],
  }
  input.connections.push(longer)
  input.buses![0].connectionNames.push(longer.name)
  for (const connection of [input.connections[2], longer])
    input.obstacles.push(
      ...connection.pointsToConnect.map((point, side) => ({
        componentId: `U${side}`,
        shape: "circle" as const,
        center: { x: point.x, y: point.y },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: [connection.name],
      })),
    )
  // Keep the same relative timing window on a larger physical fixture so
  // the existing rounded tuner has room for the shorter member's bank.
  scaleFixture(input, paired)
  const before = structuredClone({ input, paired })
  const traces = match(input, paired)
  expect(traces).not.toBeNull()
  expect(traces).toHaveLength(4)
  expect(traces!.slice(0, 2)).toEqual(paired)
  const [bus] = busLengthReports(input, traces!)
  expect(bus.matched).toBe(true)
  expect(bus.withinLengthLimit).toBe(true)
  expect(bus.skewMm!).toBeLessThanOrEqual(1.5 + 1e-7)
  const data = traces!.find((trace) => trace.connection_name === "DATA")!
  expect(length(data.route)).toBeGreaterThanOrEqual(8.7 - 1e-7)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: traces! },
      clearance: 0.1,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  expect({ input, paired }).toEqual(before)
})

test("overlapping bus skew windows retain the stricter limit", () => {
  const { input, paired } = fixture()
  input.buses!.push({
    busId: "TIGHTER_BUS",
    connectionNames: ["P", "N", "DATA"],
    maxLengthSkew: 0.3,
  })
  const before = structuredClone({ input, paired })
  expect(match(input, paired)).toBeNull()
  expect({ input, paired }).toEqual(before)
})

function addPairedFanouts(input: SimpleRouteJson, paired: Trace[]) {
  input.traces = paired.map((trace) => {
    const start = trace.route[0]
    return {
      type: "pcb_trace",
      pcb_trace_id: `fixed_${trace.connection_name}`,
      connection_name: trace.connection_name,
      source_trace_id: trace.source_trace_id,
      route: [
        {
          route_type: "wire",
          x: start.x - 3.5,
          y: start.y,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          x: start.x,
          y: start.y,
          width: 0.1,
          layer: "top",
        },
      ],
    }
  })
  input.buses![0].maxLength = 13.5
}

test("anchor windows count immutable paired fanouts in total copper length", () => {
  const { input, paired } = fixture()
  scaleFixture(input, paired)
  addPairedFanouts(input, paired)
  const before = structuredClone({ input, paired })
  const traces = match(input, paired)
  expect(traces).not.toBeNull()
  expect(traces!.slice(0, 2)).toEqual(paired)
  const [bus] = busLengthReports(input, traces!)
  expect(bus.matched).toBe(true)
  expect(bus.withinLengthLimit).toBe(true)
  expect(bus.lengths.slice(0, 2).map((member) => member.totalLengthMm)).toEqual(
    [12.5, 12.5],
  )
  const data = traces!.find((trace) => trace.connection_name === "DATA")!
  expect(length(data.route)).toBeGreaterThanOrEqual(11 - 1e-7)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: [...input.traces!, ...traces!] },
      clearance: 0.1,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  expect({ input, paired }).toEqual(before)
})

for (const fixedLength of [0.5, 3.5])
  test(`ordinary ${fixedLength} mm fixed fanout reduces its remaining timing budget`, () => {
    const { input, paired } = fixture()
    scaleFixture(input, paired)
    addPairedFanouts(input, paired)
    const start = input.connections[2].pointsToConnect[0]
    input.traces!.push({
      type: "pcb_trace",
      pcb_trace_id: "fixed_DATA",
      connection_name: "DATA",
      source_trace_id: "DATA",
      route: [
        {
          route_type: "wire",
          x: start.x - fixedLength,
          y: start.y,
          layer: "top",
          width: 0.1,
        },
        { ...start, route_type: "wire", width: 0.1 },
      ],
    })
    const before = structuredClone({ input, paired })
    const traces = match(input, paired)
    if (fixedLength === 3.5) expect(traces).toBeNull()
    else {
      expect(traces).not.toBeNull()
      const [bus] = busLengthReports(input, traces!)
      expect(bus.matched).toBe(true)
      expect(bus.withinLengthLimit).toBe(true)
      const data = bus.lengths.find((member) => member.name === "DATA")!
      expect(data.fixedLengthMm).toBeCloseTo(fixedLength, 8)
      expect(data.totalLengthMm!).toBeGreaterThanOrEqual(11 - 1e-7)
      expect(traces!.slice(0, 2)).toEqual(paired)
      expect(
        validateRoutedCopperDrc({
          inputSrj: input,
          routedSrj: { ...input, traces: [...input.traces!, ...traces!] },
          clearance: 0.1,
        } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
      ).toBe(true)
    }
    expect({ input, paired }).toEqual(before)
  })
