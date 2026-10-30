import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  BusLanesPipelineSolver,
  BusLanesSolver,
  type SimpleRouteJson,
} from "../../lib"
import { length } from "../../lib/geometry"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"
import { pairOnlyInput } from "../fixtures/pair-only-length-target"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("a pair-only bus completes without artificial tuning headroom", async () => {
  const input = pairOnlyInput()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expectCompletedRouting(solver, before)
  for (const trace of solver.traces)
    expect(length(trace.route)).toBeLessThan(13)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1000,
      height: 450,
      showSolderMask: false,
      hiddenLayerOpacity: 1,
      xRayElementIds: circuit.flatMap((element) =>
        element.type === "pcb_trace"
          ? [element.pcb_trace_id]
          : element.type === "pcb_smtpad"
            ? [element.pcb_smtpad_id]
            : [],
      ),
    },
  })
}, 30000)

test("the same pair without the bus target remains a completed positive control", async () => {
  const input = pairOnlyInput()
  input.buses = []
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expectCompletedRouting(solver, before)
  // Fresh routed copper normalized to 1 um matches the pre-fix positive control.
  const copper = solver.traces.map((trace) =>
    trace.route.map((point) => ({
      ...point,
      x: Number(point.x.toFixed(6)),
      y: Number(point.y.toFixed(6)),
    })),
  )
  expect(
    createHash("sha256").update(JSON.stringify(copper)).digest("hex"),
  ).toBe("2aeb67090fa1997e9cdd87a212e478cd471bd633247b25ae0d8c08d984a7b218")
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "bus-free-control",
    svgOptions: {
      width: 1000,
      height: 450,
      showSolderMask: false,
      hiddenLayerOpacity: 1,
      xRayElementIds: circuit.flatMap((element) =>
        element.type === "pcb_trace"
          ? [element.pcb_trace_id]
          : element.type === "pcb_smtpad"
            ? [element.pcb_smtpad_id]
            : [],
      ),
    },
  })
}, 30000)

for (const constraint of [
  "feasible range",
  "excessive minimum",
  "short maximum",
  "explicit excessive target",
] as const) {
  test(`pair-only targets honor ${constraint}`, () => {
    const input = pairOnlyInput()
    if (constraint === "feasible range")
      Object.assign(input.buses![0], { minLength: 12.3, maxLength: 13 })
    if (constraint === "excessive minimum") input.buses![0].minLength = 14
    if (constraint === "short maximum") input.buses![0].maxLength = 11
    const before = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input, {
      maxRoutingTimeMs: 20000,
      singleCarrier: {
        busTargetLength:
          constraint === "explicit excessive target" ? 14 : undefined,
      },
    })
    solver.solve()
    if (constraint === "feasible range") expectCompletedRouting(solver, before)
    else {
      expect(solver.solved).toBe(false)
      expect(solver.failed).toBe(true)
      expect(solver.traces).toHaveLength(0)
      expect(input).toEqual(before)
    }
  }, 30000)
}

test("a mixed bus retains headroom while an explicit target remains authoritative", () => {
  const input = pairOnlyInput()
  input.bounds = { ...input.bounds, minY: -4, maxY: 4 }
  const ordinary = {
    name: "D",
    pointsToConnect: [
      { x: -6, y: 2.5, layer: "top" },
      { x: 6, y: 2.5, layer: "top" },
    ],
  }
  input.connections.push(ordinary)
  for (const [side, point] of ordinary.pointsToConnect.entries())
    input.obstacles.push({
      type: "rect",
      shape: "circle",
      componentId: `package_${side}`,
      center: { x: point.x, y: point.y },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: [ordinary.name],
    })
  const before = structuredClone(input)
  const automatic = new BusLanesPipelineSolver(input, {
    maxRoutingTimeMs: 20000,
  })
  automatic.solve()
  // This bounded package cannot fit the retained 15% bank headroom.
  expect(automatic.failed).toBe(true)
  expect(automatic.solved).toBe(false)
  expect(automatic.traces).toHaveLength(0)
  expect(input).toEqual(before)
  const explicit = new BusLanesPipelineSolver(input, {
    maxRoutingTimeMs: 20000,
    singleCarrier: { busTargetLength: 13 },
  })
  explicit.solve()
  expectCompletedRouting(explicit, before)
  for (const trace of explicit.traces.filter(
    (trace) => trace.connection_name !== "D",
  ))
    expect(length(trace.route)).toBeGreaterThanOrEqual(13)
}, 30000)

test("pair and bus measurements include immutable fixed signal stubs", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.075,
    bounds: { minX: -3, maxX: 12, minY: -2, maxY: 2 },
    obstacles: [],
    connections: ["P", "N"].map((name, side) => ({
      name,
      pointsToConnect: [
        { x: 0, y: side * 0.2, layer: "top" },
        { x: 10, y: side * 0.2, layer: "top" },
      ],
    })),
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.1, lengthTolerance: 0.01 },
    ],
    buses: [
      {
        busId: "PAIR",
        connectionNames: ["P", "N"],
        minLength: 12,
        maxLength: 12,
        maxLengthSkew: 0.01,
      },
    ],
    traces: ["P", "N"].map((name, side) => ({
      type: "pcb_trace",
      pcb_trace_id: `fixed_${name}`,
      connection_name: name,
      route: [-2, 0].map((x) => ({
        route_type: "wire",
        x,
        y: side * 0.2,
        layer: "top",
        width: 0.1,
      })),
    })),
  }
  const before = structuredClone(input)
  const solver = new BusLanesSolver(input)
  solver.solve()
  expectCompletedRouting(solver, before)
  for (const report of [
    busLengthReports(input, solver.traces)[0],
    pairLengthReports(input, solver.traces)[0],
  ]) {
    expect(report.matched).toBe(true)
    expect(report.skewMm).toBeCloseTo(0, 8)
    for (const conductor of report.lengths) {
      expect(conductor.carrierLengthMm).toBeCloseTo(10, 8)
      expect(conductor.fixedLengthMm).toBeCloseTo(2, 8)
      expect(conductor.totalLengthMm).toBeCloseTo(12, 8)
    }
  }
  const capped = {
    ...input,
    buses: [{ ...input.buses![0], minLength: undefined, maxLength: 11.9 }],
  }
  const rejected = new BusLanesSolver(capped)
  rejected.solve()
  expect(rejected.solved).toBe(false)
  expect(capped.traces).toEqual(before.traces)
})
