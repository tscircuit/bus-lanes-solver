import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  BusLanesPipelineSolver,
  type Connection,
  type Obstacle,
  type SimpleRouteJson,
  type Trace,
} from "../lib"
import { routeAlternateSignalDogbones } from "../lib/alternate-signal-dogbones"
import { independentBusGroups } from "../lib/route-independent-buses"
import { loadAm3352ByteStallInput } from "../scripts/load-am3352-byte-stall-input"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"

function createDiagonalDualByteFixture() {
  const pitch = 0.8
  const padSize = 0.35
  const cpuOrigin = { x: 0, y: 0 }
  // Diagonal RAM offset matching the (-11.4, -26) aspect direction (~ -0.44 : -1)
  const ramOrigin = { x: -4.4, y: -10.0 }

  const obstacles: Obstacle[] = []
  const addGridComponent = (
    componentId: string,
    origin: { x: number; y: number },
    cols: number,
    rows: number,
  ) => {
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const x = Number((origin.x + (col - (cols - 1) / 2) * pitch).toFixed(6))
        const y = Number((origin.y - row * pitch).toFixed(6))
        const padId = `${componentId}_pad_${col}_${row}`
        obstacles.push({
          type: "oval",
          shape: "circle",
          componentId,
          layers: ["top"],
          center: { x, y },
          width: padSize,
          height: padSize,
          connectedTo: [padId],
        })
      }
    }
  }

  addGridComponent("cpu_pkg", cpuOrigin, 7, 4)
  addGridComponent("ram_pkg", ramOrigin, 7, 4)

  const connectPads = (
    name: string,
    cpuCol: number,
    cpuRow: number,
    ramCol: number,
    ramRow: number,
  ): Connection => {
    const cpuPad = obstacles.find((o) =>
      o.connectedTo.includes(`cpu_pkg_pad_${cpuCol}_${cpuRow}`),
    )!
    const ramPad = obstacles.find((o) =>
      o.connectedTo.includes(`ram_pkg_pad_${ramCol}_${ramRow}`),
    )!
    cpuPad.connectedTo.push(name)
    ramPad.connectedTo.push(name)
    return {
      name,
      source_trace_id: name,
      nominalTraceWidth: 0.1,
      width: 0.1,
      pointsToConnect: [
        {
          x: cpuPad.center.x,
          y: cpuPad.center.y,
          layer: "top",
          pointId: `${name}_cpu`,
          pcb_port_id: `${name}_cpu`,
        },
        {
          x: ramPad.center.x,
          y: ramPad.center.y,
          layer: "top",
          pointId: `${name}_ram`,
          pcb_port_id: `${name}_ram`,
        },
      ],
    }
  }

  // BYTE1 (left columns 0..2 on bottom row 3 / row 2 of CPU -> top rows 0..1 of RAM)
  const b1Connections: Connection[] = [
    connectPads("DQS1", 0, 3, 0, 0),
    connectPads("DQSn1", 1, 3, 1, 0),
    connectPads("D8", 2, 3, 2, 0),
    connectPads("D9", 0, 2, 0, 1),
    connectPads("D10", 1, 2, 1, 1),
  ]

  // BYTE0 (right columns 4..6 on bottom row 3 / row 2 of CPU -> top rows 0..1 of RAM)
  const b0Connections: Connection[] = [
    connectPads("DQS0", 4, 3, 4, 0),
    connectPads("DQSn0", 5, 3, 5, 0),
    connectPads("D0", 6, 3, 6, 0),
    connectPads("D1", 4, 2, 4, 1),
    connectPads("D2", 5, 2, 5, 1),
  ]

  const baseInput: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.08,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.2,
    bounds: {
      minX: -14,
      maxX: 10,
      minY: -18,
      maxY: 6,
    },
    obstacles,
    connections: [],
  }

  return { baseInput, b0Connections, b1Connections }
}

test("AM3352 diagonal (-11.4, -26) 4-bus layer-cohort dispatches directly to independent lanes_route", () => {
  const byteStall = loadAm3352ByteStallInput()
  const whole = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/am3352-fresh-native/whole-ddr.simple-route.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as SimpleRouteJson

  const ramPads = whole.obstacles.filter(
    (o) => o.componentId === "pcb_component_1",
  )
  const ramCenterX =
    (Math.min(...ramPads.map((o) => o.center.x)) +
      Math.max(...ramPads.map((o) => o.center.x))) /
    2
  const ramCenterY =
    (Math.min(...ramPads.map((o) => o.center.y)) +
      Math.max(...ramPads.map((o) => o.center.y))) /
    2
  const dx = -11.4 - ramCenterX
  const dy = -26.0 - ramCenterY

  const translatedObstacles = whole.obstacles.map((o) =>
    o.componentId === "pcb_component_1" || o.center.y < -18
      ? { ...o, center: { x: o.center.x + dx, y: o.center.y + dy } }
      : { ...o },
  )

  const byte0TopNames = byteStall.buses![0]!.connectionNames
  const byte0BotNames = byteStall.buses![1]!.connectionNames
  const byte1All = whole.buses![1]!.connectionNames
  const byte1TopNames = [
    "source_trace_27",
    "source_trace_26",
    "source_trace_28",
    "source_trace_12",
    "source_trace_13",
  ]
  const byte1BotNames = byte1All.filter((n) => !byte1TopNames.includes(n))
  const activeNames = new Set([...byte0TopNames, ...byte0BotNames, ...byte1All])

  const translatedConnections = whole.connections
    .filter((c) => activeNames.has(c.name))
    .map((c) => ({
      ...c,
      pointsToConnect: c.pointsToConnect.map((p) =>
        p.y < -18 ? { ...p, x: p.x + dx, y: p.y + dy } : { ...p },
      ),
    }))

  const fourCohortInput: SimpleRouteJson = {
    ...whole,
    obstacles: translatedObstacles,
    connections: translatedConnections,
    differentialPairs: whole.differentialPairs!.slice(0, 2),
    buses: [
      {
        busId: "DDR_BYTE0_TOP",
        name: "DDR_BYTE0_TOP",
        connectionNames: byte0TopNames,
        minLength: 37.420123,
        maxLength: 38.057123,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["top"],
      },
      {
        busId: "DDR_BYTE0_BOTTOM",
        name: "DDR_BYTE0_BOTTOM",
        connectionNames: byte0BotNames,
        minLength: 37.420123,
        maxLength: 38.057123,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["bottom"],
      },
      {
        busId: "DDR_BYTE1_TOP",
        name: "DDR_BYTE1_TOP",
        connectionNames: byte1TopNames,
        minLength: 34.854169,
        maxLength: 35.489169,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["top"],
      },
      {
        busId: "DDR_BYTE1_BOTTOM",
        name: "DDR_BYTE1_BOTTOM",
        connectionNames: byte1BotNames,
        minLength: 34.854169,
        maxLength: 35.489169,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["bottom"],
      },
    ],
  }

  const before = structuredClone(fourCohortInput)
  const solver = new BusLanesPipelineSolver(fourCohortInput)
  try {
    solver.step()
    expect(solver.failed).toBe(false)
    expect(solver.error).toBeNull()
    expect(solver.phase).toBe("lanes_route")
    expect((solver.stats as { totalLanes?: number }).totalLanes).toBe(22)
    expect(fourCohortInput).toEqual(before)
  } finally {
    solver.tryFinalAcceptance()
  }
}, 45_000)

test("diagonal 4-bus layer-cohort co-solve completes two byte groups sharing top-layer differential pairs", () => {
  const { baseInput, b0Connections, b1Connections } =
    createDiagonalDualByteFixture()
  const input: SimpleRouteJson = {
    ...structuredClone(baseInput),
    connections: [...b0Connections, ...b1Connections],
    differentialPairs: [
      {
        connectionNames: ["DQS0", "DQSn0"],
        lengthTolerance: 0.127,
        traceGap: 0.12,
      },
      {
        connectionNames: ["DQS1", "DQSn1"],
        lengthTolerance: 0.127,
        traceGap: 0.12,
      },
    ],
    buses: [
      {
        busId: "BYTE0_TOP",
        name: "BYTE0_TOP",
        connectionNames: ["DQS0", "DQSn0", "D0"],
        maxLength: 18,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["top"],
      },
      {
        busId: "BYTE0_BOTTOM",
        name: "BYTE0_BOTTOM",
        connectionNames: ["D1", "D2"],
        maxLength: 18,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["bottom"],
      },
      {
        busId: "BYTE1_TOP",
        name: "BYTE1_TOP",
        connectionNames: ["DQS1", "DQSn1", "D8"],
        maxLength: 18,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["top"],
      },
      {
        busId: "BYTE1_BOTTOM",
        name: "BYTE1_BOTTOM",
        connectionNames: ["D9", "D10"],
        maxLength: 18,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["bottom"],
      },
    ],
  }

  const assignedSurface = {
    ...input,
    connections: input.connections.map((c) => {
      const bus = input.buses!.find((b) => b.connectionNames.includes(c.name))!
      const layer = bus.allowedLayers![0]!
      return {
        ...c,
        pointsToConnect: c.pointsToConnect.map((p) => ({ ...p, layer })),
      }
    }),
  }
  const groups = independentBusGroups(assignedSurface)
  expect(groups).not.toBeNull()
  expect(groups!).toHaveLength(2)
  expect(groups![0]!.differentialPairs).toHaveLength(2)

  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    maxSearchIterations: 60_000,
  })
  solver.solve()
  expectCompletedRouting(solver, original)
  expect(solver.traces).toHaveLength(10)
}, 60_000)

test("preloaded fixed copper blocking adjacent 4-cell dogbone sites falls back to expanded interstitial escapes on single-layer cohorts", () => {
  const { baseInput, b0Connections, b1Connections } =
    createDiagonalDualByteFixture()

  // Route BYTE0 first on diagonal placement
  const b0Input: SimpleRouteJson = {
    ...structuredClone(baseInput),
    connections: b0Connections,
    differentialPairs: [
      {
        connectionNames: ["DQS0", "DQSn0"],
        lengthTolerance: 0.127,
        traceGap: 0.12,
      },
    ],
    buses: [
      {
        busId: "BYTE0_TOP",
        name: "BYTE0_TOP",
        connectionNames: ["DQS0", "DQSn0", "D0"],
        maxLength: 18,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["top"],
      },
      {
        busId: "BYTE0_BOTTOM",
        name: "BYTE0_BOTTOM",
        connectionNames: ["D1", "D2"],
        maxLength: 18,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["bottom"],
      },
    ],
  }
  const b0Solver = new BusLanesPipelineSolver(b0Input, {
    maxSearchIterations: 40_000,
  })
  b0Solver.solve()
  expectCompletedRouting(b0Solver, structuredClone(b0Input))

  // Also add fixed copper blocking the 4 immediately adjacent interstitial cells of D10's CPU pad
  // while leaving nearby 1.5-pitch interstitial cells open, reproducing #6213's preferred_assignment failure.
  const d10Cpu = b1Connections.find((c) => c.name === "D10")!
    .pointsToConnect[0]!
  const blockerOffsets = [
    { ox: -0.4, oy: 0.4, dx: 0, dy: 0.12 },
    { ox: 0.4, oy: 0.4, dx: 0, dy: 0.12 },
    { ox: -0.4, oy: -0.4, dx: 0, dy: -0.12 },
    { ox: 0.4, oy: -0.4, dx: 0, dy: -0.12 },
  ]
  const blockerConnections: Connection[] = []
  const blockerTraces: Trace[] = blockerOffsets.map(
    ({ ox, oy, dx, dy }, idx) => {
      const vx = Number((d10Cpu.x + ox).toFixed(6))
      const vy = Number((d10Cpu.y + oy).toFixed(6))
      const ax = Number((vx + dx).toFixed(6))
      const ay = Number((vy + dy).toFixed(6))
      const bx = Number((vx - dx).toFixed(6))
      const by = Number((vy - dy).toFixed(6))
      const name = `FIXED_BLOCKER_${idx}`
      blockerConnections.push({
        name,
        source_trace_id: name,
        nominalTraceWidth: 0.1,
        width: 0.1,
        pointsToConnect: [
          { x: ax, y: ay, layer: "inner1", pointId: `${name}_a` },
          { x: bx, y: by, layer: "inner2", pointId: `${name}_b` },
        ],
      })
      return {
        type: "pcb_trace",
        pcb_trace_id: `fixed_blocker_trace_${idx}`,
        connection_name: name,
        source_trace_id: name,
        route: [
          { x: ax, y: ay, route_type: "wire", layer: "inner1", width: 0.1 },
          { x: vx, y: vy, route_type: "wire", layer: "inner1", width: 0.1 },
          {
            x: vx,
            y: vy,
            route_type: "via",
            from_layer: "inner1",
            to_layer: "inner2",
            layers: ["top", "inner1", "inner2", "bottom"],
            via_diameter: 0.3,
            via_hole_diameter: 0.15,
          },
          { x: vx, y: vy, route_type: "wire", layer: "inner2", width: 0.1 },
          { x: bx, y: by, route_type: "wire", layer: "inner2", width: 0.1 },
        ],
      }
    },
  )

  const b1PreloadedInput: SimpleRouteJson = {
    ...structuredClone(baseInput),
    connections: b1Connections,
    traces: [...b0Solver.traces, ...blockerTraces],
    differentialPairs: [
      {
        connectionNames: ["DQS1", "DQSn1"],
        lengthTolerance: 0.127,
        traceGap: 0.12,
      },
    ],
    buses: [
      {
        busId: "BYTE1_TOP",
        name: "BYTE1_TOP",
        connectionNames: ["DQS1", "DQSn1", "D8"],
        maxLength: 18,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["top"],
      },
      {
        busId: "BYTE1_BOTTOM",
        name: "BYTE1_BOTTOM",
        connectionNames: ["D9", "D10"],
        maxLength: 18,
        maxLengthSkew: 0.635,
        traceWidth: 0.1,
        allowedLayers: ["bottom"],
      },
    ],
  }

  // Confirm all 4 standard 4-cell dogbone quadrant attempts fail for BYTE1_BOTTOM
  const targetMap = new Map<string, string>([
    ["DQS1", "top"],
    ["DQSn1", "top"],
    ["D8", "top"],
    ["D9", "bottom"],
    ["D10", "bottom"],
  ])
  for (let attempt = 0; attempt < 4; attempt++) {
    expect(() =>
      routeAlternateSignalDogbones(
        b1PreloadedInput,
        {
          targetLayers: targetMap,
          viaDiameter: 0.3,
          viaHoleDiameter: 0.15,
          traceWidth: 0.1,
          clearance: 0.08,
          holeToHoleClearance: 0.1,
          boardEdgeClearance: 0.2,
        },
        attempt,
      ),
    ).toThrow("No collision-free local dogbone assignment")
  }

  const original = structuredClone(b1PreloadedInput)
  const b1Solver = new BusLanesPipelineSolver(b1PreloadedInput, {
    maxSearchIterations: 60_000,
    singleCarrier: {
      fixedConnections: [...b0Connections, ...blockerConnections],
    },
  })
  b1Solver.solve()
  expectCompletedRouting(b1Solver, original)
  expect(b1Solver.traces).toHaveLength(5)
}, 60_000)
