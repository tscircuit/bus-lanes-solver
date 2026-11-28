import { expect, test } from "bun:test"
import {
  checkPcbBusLengthSkew,
  checkPcbRoutingConstraints,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import {
  BusLanesPipelineSolver,
  busLengthReports,
  type SimpleRouteJson,
  type Trace,
} from "../lib"
import { compactEnvelopeCandidate } from "../lib/compact-envelope"
import { signalEnvelope } from "../lib/carrier-compaction-view"
import { length } from "../lib/geometry"

function toBusCircuitJson(
  input: SimpleRouteJson,
  traces: Trace[],
): AnyCircuitElement[] {
  const elements: AnyCircuitElement[] = [
    {
      type: "pcb_board",
      pcb_board_id: "pcb_board_0",
      center: { x: 0, y: 0 },
      width: input.bounds.maxX - input.bounds.minX,
      height: input.bounds.maxY - input.bounds.minY,
      thickness: 1.6,
      num_layers: input.layerCount,
      material: "fr4",
    },
  ]
  for (const connection of input.connections) {
    elements.push({
      type: "source_trace",
      source_trace_id: connection.source_trace_id ?? connection.name,
      connected_source_port_ids: [],
      connected_source_net_ids: [],
      display_name: connection.name,
    })
  }
  for (const bus of input.buses ?? []) {
    elements.push({
      type: "source_bus",
      source_bus_id: `source_bus_${bus.busId}`,
      name: bus.busId,
      source_trace_ids: bus.connectionNames.map(
        (name) =>
          input.connections.find((c) => c.name === name)?.source_trace_id ??
          name,
      ),
      max_length_skew: bus.maxLengthSkew,
    })
  }
  for (const [index, trace] of traces.entries()) {
    const connection = input.connections.find(
      (c) => c.name === trace.connection_name,
    )
    elements.push({
      type: "pcb_trace",
      pcb_trace_id: trace.pcb_trace_id ?? `pcb_trace_${index}`,
      source_trace_id:
        trace.source_trace_id ??
        connection?.source_trace_id ??
        trace.connection_name,
      route: trace.route as never,
    })
  }
  return elements
}

function twoTracePlainBusInput(maxLengthSkew: number): SimpleRouteJson {
  const padOffset = 0.51
  return {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -4 - padOffset, y: -1.27 },
        width: 0.54,
        height: 0.64,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -4 + padOffset, y: -1.27 },
        width: 0.54,
        height: 0.64,
        connectedTo: ["DATA0"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -4 - padOffset, y: 1.27 },
        width: 0.54,
        height: 0.64,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -4 + padOffset, y: 1.27 },
        width: 0.54,
        height: 0.64,
        connectedTo: ["DATA1"],
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 4, y: 1.27 },
        width: 1.5,
        height: 1.5,
        connectedTo: ["DATA0"],
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 4, y: -1.27 },
        width: 1.5,
        height: 1.5,
        connectedTo: ["DATA1"],
      },
    ],
    connections: [
      {
        name: "DATA0",
        source_trace_id: "source_trace_0",
        pointsToConnect: [
          { x: -4 + padOffset, y: -1.27, layer: "top" },
          { x: 4, y: 1.27, layer: "top" },
        ],
      },
      {
        name: "DATA1",
        source_trace_id: "source_trace_1",
        pointsToConnect: [
          { x: -4 + padOffset, y: 1.27, layer: "top" },
          { x: 4, y: -1.27, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "DATA",
        connectionNames: ["DATA0", "DATA1"],
        maxLengthSkew,
        traceWidth: 0.15,
      },
    ],
  }
}

test.each([0.05, 0.1, 0.1001, 0.15, 0.2])(
  "tuned plain bus reserves 1nm inside maxLengthSkew=%smm and passes @tscircuit/checks",
  (maxLengthSkew) => {
    const input = twoTracePlainBusInput(maxLengthSkew)
    const original = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.error).toBeNull()

    const report = busLengthReports(input, solver.traces)[0]
    expect(report.matched).toBe(true)
    expect(report.skewMm!).toBeLessThanOrEqual(maxLengthSkew - 5e-7)

    const circuitJson = toBusCircuitJson(input, solver.traces)
    expect(checkPcbBusLengthSkew(circuitJson)).toEqual([])
    expect(checkPcbRoutingConstraints(circuitJson)).toEqual([])
    expect(solver.getOutput().buses).toEqual(original.buses)
    expect(input).toEqual(original)
  },
)

test("already-matched straight plain bus routes stay untuned without meanders", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 10, minY: -1, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    obstacles: [],
    connections: [
      {
        name: "DATA0",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 8, y: 0, layer: "top" },
        ],
      },
      {
        name: "DATA1",
        pointsToConnect: [
          { x: 0, y: 0.5, layer: "top" },
          { x: 8.1, y: 0.5, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "DATA",
        connectionNames: ["DATA0", "DATA1"],
        maxLengthSkew: 0.1,
      },
    ],
  }
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  expect(solver.traces.map((trace) => trace.route.length)).toEqual([2, 2])
  expect(
    solver.traces.map((trace) => length(trace.route)).sort((a, b) => a - b),
  ).toEqual([8, 8.1])
  expect(checkPcbBusLengthSkew(toBusCircuitJson(input, solver.traces))).toEqual(
    [],
  )
  expect(input).toEqual(original)
})

test("coordinated envelope compaction caps non-cohort skew inside reserveSkewRoundoff", () => {
  const traces: Trace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "short",
      connection_name: "short",
      route: [
        [0, 0],
        [1, 1],
        [1, 5],
        [2, 6],
        [8, 6],
        [9, 5],
        [9, 1],
        [10, 0],
      ].map(([x, y]) => ({
        route_type: "wire" as const,
        x,
        y,
        layer: "top",
        width: 0.1,
      })),
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "long",
      connection_name: "long",
      route: [
        [0, 0],
        [14 + 4 * Math.SQRT2, 0],
      ].map(([x, y]) => ({
        route_type: "wire" as const,
        x,
        y,
        layer: "bottom",
        width: 0.1,
      })),
    },
  ]
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 25, minY: -2, maxY: 10 },
    obstacles: [],
    connections: traces.map((t) => ({
      name: t.connection_name!,
      pointsToConnect: [t.route[0], t.route.at(-1)!] as never,
    })),
    buses: [
      {
        busId: "DATA",
        connectionNames: ["short", "long"],
        maxLengthSkew: 0.1,
      },
    ],
  }
  const search = compactEnvelopeCandidate(input, traces, "coordinated")
  let step = search.next()
  while (!step.done) step = search.next()
  const compacted = step.value

  expect(signalEnvelope(compacted).areaMm2).toBeLessThan(
    signalEnvelope(traces).areaMm2,
  )
  const report = busLengthReports(input, compacted)[0]
  expect(report.matched).toBe(true)
  expect(report.skewMm!).toBeLessThanOrEqual(0.1 - 5e-7)
  expect(checkPcbBusLengthSkew(toBusCircuitJson(input, compacted))).toEqual([])
})
