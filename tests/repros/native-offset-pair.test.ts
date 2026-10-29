import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { offsetNativePair } from "../fixtures/offset-native-pair"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { sharedPairSpacingReports } from "../../lib/shared-pair-spacing"

for (const gapSource of [
  "explicit",
  "clearance",
  "margin",
  "default",
] as const) {
  test(`offset packages complete with ${gapSource} differential-pair spacing`, async () => {
    const input = offsetNativePair()
    if (gapSource !== "explicit") delete input.differentialPairs![0].traceGap
    if (gapSource === "clearance") input.minTraceToPadEdgeClearance = 0.075
    if (gapSource === "margin" || gapSource === "default")
      delete input.minTraceToPadEdgeClearance
    if (gapSource === "margin") input.defaultObstacleMargin = 0.075
    const before = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input, {
      maxRoutingTimeMs: 20000,
    })
    solver.solve()
    expectCompletedRouting(solver, before)
    const expectedGapMm =
      input.differentialPairs![0].traceGap ??
      input.minTraceToPadEdgeClearance ??
      input.defaultObstacleMargin ??
      0.075
    const spacing = sharedPairSpacingReports(
      {
        ...input,
        differentialPairs: [
          { ...input.differentialPairs![0], traceGap: expectedGapMm },
        ],
      },
      solver.traces,
    )
    expect(spacing[0].sharedSectionPresent).toBe(true)
    expect(spacing[0].matched).toBe(true)
    if (gapSource === "explicit") {
      const circuit = nativePairCircuit({ input, traces: solver.traces })
      await expect(circuit).toMatchPcbSnapshot({
        testPath: import.meta.path,
        svgOptions: {
          width: 1000,
          height: 650,
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
    }
  }, 30000)
}

test("the aligned-package positive control completes with unchanged copper", () => {
  const input = offsetNativePair()
  for (const connection of input.connections) {
    const target = connection.pointsToConnect[1]
    const pad = input.obstacles.find(
      (obstacle) =>
        obstacle.center.x === target.x && obstacle.center.y === target.y,
    )!
    target.y -= 2
    pad.center.y -= 2
  }
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expectCompletedRouting(solver, before)
}, 30000)

for (const scenario of [
  "different package sizes",
  "blocked shortest approach",
  "congested package exits",
  "immutable fixed copper",
] as const) {
  test(`offset routing handles ${scenario}`, () => {
    const input = offsetNativePair()
    if (scenario === "different package sizes") {
      for (const pad of input.obstacles) {
        pad.width = pad.center.x < 0 ? 0.6 : 0.3
        pad.height = pad.width
      }
    }
    if (scenario === "blocked shortest approach")
      input.obstacles.push({
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 3,
        layers: ["inner1"],
        connectedTo: [],
      })
    if (scenario === "congested package exits") {
      for (const y of [-1.5, -0.5])
        input.obstacles.push({
          type: "rect",
          shape: "circle",
          center: { x: -5.5, y },
          width: 0.3,
          height: 0.3,
          layers: ["top", "inner1"],
          connectedTo: [],
        })
    }
    const power = {
      name: "power",
      pointsToConnect: [
        { x: -6, y: 4, layer: "inner1" },
        { x: -5.5, y: 4, layer: "inner1" },
      ],
    }
    if (scenario === "immutable fixed copper")
      input.traces = [
        {
          type: "pcb_trace",
          pcb_trace_id: "fixed_power",
          connection_name: "power",
          route: power.pointsToConnect.map((point) => ({
            ...point,
            route_type: "wire",
            width: 0.1,
          })),
        },
      ]
    const before = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input, {
      maxRoutingTimeMs: 20000,
      singleCarrier: {
        fixedConnections: scenario === "immutable fixed copper" ? [power] : [],
      },
    })
    solver.solve()
    expectCompletedRouting(solver, before)
    if (scenario === "blocked shortest approach")
      expect(
        solver.traces.some((trace) =>
          trace.route.some((point) => Math.abs(point.y) > 1.7),
        ),
      ).toBe(true)
  }, 30000)
}

test("exhausted offset candidates fail explicitly without modifying fixed input", () => {
  const input = offsetNativePair()
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 10,
    layers: ["inner1"],
    connectedTo: [],
  })
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.failureCode).toBe("native_single_carrier_matching_failed")
  expect(solver.traces).toHaveLength(0)
  expect(input).toEqual(before)
}, 30000)

test("explicit caller centerlines remain supported", () => {
  const input = offsetNativePair()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    maxRoutingTimeMs: 20000,
    singleCarrier: {
      centerlines: [
        [
          { x: -5.6, y: -1 },
          { x: -4.4, y: -1 },
          { x: -2.4, y: 1 },
          { x: 5.6, y: 1 },
        ],
      ],
    },
  })
  solver.solve()
  expectCompletedRouting(solver, before)
}, 30000)
