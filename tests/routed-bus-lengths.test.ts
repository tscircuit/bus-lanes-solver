import { expect, test } from "bun:test"
import { RoutedBusCopper } from "../lib/routed-bus-lengths/routed-bus-copper"
import { RoutedBusLengthSolver } from "../lib/routed-bus-lengths/routed-bus-length-solver"
import { busLengthReports } from "../lib/route-lengths"
import type { SimpleRouteJson, Trace } from "../lib/types"

const wire = (x: number, y: number) => ({
  route_type: "wire" as const,
  x,
  y,
  layer: "top",
  width: 0.15,
})
const straightTrace = (connectionName: string): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: connectionName,
  connection_name: connectionName,
  route: [wire(0, 0), wire(10, 0)],
})
const board: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minTraceToPadEdgeClearance: 0.1,
  minViaPadDiameter: 0.45,
  minViaHoleDiameter: 0.2,
  bounds: { minX: -2, maxX: 12, minY: -5, maxY: 8 },
  obstacles: [],
  connections: [
    {
      name: "DQ",
      nominalTraceWidth: 0.15,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "cpu" },
        { x: 10, y: 0, layer: "top", pcb_port_id: "ram" },
      ],
    },
  ],
}

test("holds a clock termination fixed and measures the two named pads", () => {
  const clock = straightTrace("CK")
  const branch = {
    ...clock,
    pcb_trace_id: "termination",
    route: [wire(10, 0), wire(11, 2)],
  }
  const input: SimpleRouteJson = {
    ...board,
    connections: [
      {
        name: "CK",
        pointsToConnect: [
          { x: 11, y: 2, layer: "top", pcb_port_id: "resistor" },
          ...board.connections[0].pointsToConnect,
        ],
      },
    ],
    traces: [branch],
    buses: [
      {
        busId: "clock",
        connectionNames: ["CK"],
        minLength: 9.99,
        maxLength: 10.01,
        lengthMatchingPaths: [
          { connectionName: "CK", pcbPortIds: ["cpu", "ram"] },
        ],
      },
    ],
  }
  const solver = new RoutedBusLengthSolver({ input, routedTraces: [clock] })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput().traces[0]).toBe(clock)
  expect(input.traces?.[0]).toBe(branch)
  expect(
    busLengthReports(input, solver.getOutput().traces)[0].lengths[0]
      .totalLengthMm,
  ).toBe(10)
})

test("rejects inconsistent absolute limits without returning partial geometry", () => {
  const input = {
    ...board,
    buses: [
      {
        busId: "impossible",
        connectionNames: ["DQ"],
        minLength: 12,
        maxLength: 8,
      },
    ],
  }
  const solver = new RoutedBusLengthSolver({
    input,
    routedTraces: [straightTrace("DQ")],
  })
  expect(() => {
    solver.solve()
    solver.getOutput()
  }).toThrow()
  expect(solver.solved).toBe(false)
})

test("replans a pad approach that only fits at the narrower initial trace width", () => {
  const original = straightTrace("DQ")
  const input: SimpleRouteJson = {
    ...board,
    connections: [{ ...board.connections[0], nominalTraceWidth: 0.3 }],
    obstacles: [
      {
        type: "rect",
        center: { x: 5, y: 0.35 },
        width: 1,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["VCC"],
      },
    ],
    buses: [
      {
        busId: "data",
        connectionNames: ["DQ"],
        minLength: 9.99,
        maxLength: 10.1,
      },
    ],
  }
  const solver = new RoutedBusLengthSolver({ input, routedTraces: [original] })
  solver.solve()
  const [routed] = solver.getOutput().traces
  const copper = new RoutedBusCopper(input, [])
  expect(copper.clearsBoard(copper.prepareNominal(original))).toBe(false)
  expect(copper.clearsBoard(routed)).toBe(true)
  expect(
    routed.route
      .filter((point) => point.route_type === "wire")
      .every((point) => point.width >= 0.3),
  ).toBe(true)
  expect(busLengthReports(input, [routed])[0].withinLengthLimit).toBe(true)
})
