import { pointSegmentDistance } from "../lib/geometry"
import { expect, test } from "bun:test"
import { BusLanesSolver, type SimpleRouteJson } from "../lib"
const input = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: -2, maxX: 12, minY: -5, maxY: 5 },
  obstacles: [],
  connections: [
    {
      name: "a",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 10, y: 0, layer: "top" },
      ],
    },
    {
      name: "b",
      pointsToConnect: [
        { x: 0, y: 2, layer: "top" },
        { x: 8, y: 2, layer: "top" },
      ],
    },
  ],
  buses: [{ busId: "DATA", connectionNames: ["a", "b"], maxLengthSkew: 0.01 }],
})
test("routes and length matches lanes without any layer transitions", () => {
  const s = new BusLanesSolver(input())
  s.solve()
  expect(s.error).toBeNull()
  expect(s.solved).toBe(true)
  expect(
    s.traces
      .flatMap((t) => t.route)
      .every((p) => p.route_type === "wire" && p.layer === "top"),
  ).toBe(true)
  expect(
    Math.abs(
      s.stats.traceLengthsMm[0].length - s.stats.traceLengthsMm[1].length,
    ),
  ).toBeCloseTo(0.01, 7)
})
test("fails rather than routing a via between different endpoint layers", () => {
  const j = input()
  j.connections[0].pointsToConnect[1].layer = "bottom"
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.failureCode).toBe("layer_change_required")
  expect(() => s.getOutput()).toThrow()
})
test("cannot cross a blocking wall and leaves input untouched", () => {
  const j = input()
  j.buses = []
  j.obstacles = [
    {
      center: { x: 5, y: 0 },
      width: 1,
      height: 20,
      layers: ["top"],
      connectedTo: [],
    },
  ]
  const before = JSON.stringify(j)
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.failed).toBe(true)
  expect(s.failureCode).toBe("no_planar_route")
  expect(JSON.stringify(j)).toBe(before)
})
test("uses the existing SRJ bus trace width", () => {
  const j = input()
  j.buses![0].traceWidth = 0.15
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.solved).toBe(true)
  expect(
    s.traces.every((t) =>
      t.route.every((p) => p.route_type === "wire" && p.width === 0.15),
    ),
  ).toBe(true)
})
test("routes around an obstacle on the same layer", () => {
  const j = input()
  j.connections = j.connections.slice(0, 1)
  j.buses = []
  j.obstacles = [
    {
      center: { x: 5, y: 0 },
      width: 1,
      height: 2,
      layers: ["top"],
      connectedTo: [],
    },
  ]
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.solved).toBe(true)
  expect(s.traces[0].route.some((p) => Math.abs(p.y) > 1)).toBe(true)
})

test("exhausted search refuses partial output", () => {
  const s = new BusLanesSolver(input(), { maxSearchIterations: 1 })
  s.solve()
  expect(s.failureCode).toBe("search_budget_exhausted")
  expect(s.phase).toBe("failed")
  expect(() => s.getOutput()).toThrow()
})

test("reserves unrouted terminals instead of letting an earlier lane occupy them", () => {
  const j = input()
  j.buses = []
  j.connections[1].pointsToConnect = [
    { x: 5, y: 0, layer: "top" },
    { x: 5, y: 2, layer: "top" },
  ]
  const before = JSON.stringify(j)
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.solved).toBe(true)
  const first = s.traces.find((t) => t.connection_name === "a")!
  for (let i = 1; i < first.route.length; i++) {
    expect(
      pointSegmentDistance({ x: 5, y: 0 }, [
        first.route[i - 1],
        first.route[i],
      ]),
    ).toBeGreaterThanOrEqual(0.174999)
  }
  expect(JSON.stringify(j)).toBe(before)
})

test("matching includes both immutable fixed fanouts, not just the carrier", () => {
  const j = input()
  j.traces = [
    {
      name: "a",
      points: [
        [-1, 0],
        [0, 0],
      ],
    },
    {
      name: "a",
      points: [
        [10, 0],
        [11, 0],
      ],
    },
    {
      name: "b",
      points: [
        [-1, 2],
        [0, 2],
      ],
    },
    {
      name: "b",
      points: [
        [8, 2],
        [11, 2],
      ],
    },
  ].map((t, i) => ({
    type: "pcb_trace",
    pcb_trace_id: `fixed_${i}`,
    source_trace_id: t.name,
    route: t.points.map(([x, y]) => ({
      route_type: "wire",
      x,
      y,
      layer: "top",
      width: 0.1,
    })),
  }))
  // Equal total length to begin with, despite different carrier lengths.
  const before = JSON.stringify(j.traces)
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.solved).toBe(true)
  expect(s.stats.busLengths[0].skewMm).toBeLessThan(1e-7)
  expect(
    s.stats.busLengths[0].lengths.map((l: any) => l.totalLengthMm),
  ).toEqual([12, 12])
  expect(JSON.stringify(s.getOutput().traces.slice(0, 4))).toBe(before)
  // Increase the fixed length on b; the carrier on a must grow to compensate.
  j.traces[2].route[0].x = -2
  const compensated = new BusLanesSolver(j)
  compensated.solve()
  expect(compensated.solved).toBe(true)
  expect(compensated.stats.busLengths[0].skewMm).toBeCloseTo(0.01, 7)
  expect(
    compensated.stats.busLengths[0].lengths[0].carrierLengthMm,
  ).toBeCloseTo(10.99, 7)
})

test("invalid skew tolerances are rejected", () => {
  for (const tolerance of [-1, NaN, Infinity]) {
    const j = input()
    j.buses![0].maxLengthSkew = tolerance
    const s = new BusLanesSolver(j)
    s.solve()
    expect(s.failed).toBe(true)
  }
})

test("meander chamfers scale with the lobe instead of using tiny corner cuts", () => {
  const s = new BusLanesSolver(input())
  s.solve()
  expect(s.solved).toBe(true)
  const tuned = s.traces.find((t) => t.connection_name === "b")!
  const diagonals = tuned.route.slice(1).flatMap((p, i) => {
    const q = tuned.route[i],
      dx = Math.abs(p.x - q.x),
      dy = Math.abs(p.y - q.y)
    return dx > 1e-7 && dy > 1e-7 ? [Math.hypot(dx, dy)] : []
  })
  expect(diagonals.length).toBeGreaterThanOrEqual(4)
  expect(Math.min(...diagonals)).toBeGreaterThan(0.4)
})

test("length tuning distributes lobes on the long run and preserves terminal approaches", async () => {
  const { tuneLengths, tuningPathIsSelfClear } = await import(
    "../lib/length-tuning"
  )
  const { length } = await import("../lib/geometry")
  const j = input()
  j.bounds = { minX: -10, maxX: 25, minY: -10, maxY: 10 }
  j.connections = [
    {
      name: "a",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 16, y: 0, layer: "top" },
      ],
    },
  ]
  const route = [
    [0, 0],
    [1, 0],
    [2, 1],
    [14, 1],
    [15, 0],
    [16, 0],
  ].map(([x, y]) => ({
    x,
    y,
    route_type: "wire" as const,
    layer: "top",
    width: 0.1,
  }))
  const target = length(route) + 4
  const [tuned] = tuneLengths(
    j,
    [
      {
        type: "pcb_trace",
        pcb_trace_id: "a",
        connection_name: "a",
        route,
      },
    ],
    new Map([["a", target]]),
  )
  expect(tuned.route.slice(0, 3)).toEqual(route.slice(0, 3))
  expect(tuned.route.slice(-3)).toEqual(route.slice(-3))
  expect(length(tuned.route)).toBeCloseTo(target, 7)
  expect(tuningPathIsSelfClear(tuned.route, 0.3)).toBe(true)
  const lobes = tuned.route.filter(
    (p) => Math.abs(p.y - 1) > 1e-7 && p.x > 2 && p.x < 14,
  )
  expect(lobes.length).toBeGreaterThan(8)
  expect(Math.min(...lobes.map((p) => p.x))).toBeLessThan(4)
  expect(Math.max(...lobes.map((p) => p.x))).toBeGreaterThan(11)
  expect(Math.max(...lobes.map((p) => Math.abs(p.y - 1)))).toBeLessThan(1)
})

test("routes already within bus tolerance receive no tuning", () => {
  const j = input()
  j.buses![0].maxLengthSkew = 2
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.solved).toBe(true)
  expect(s.traces.every((t) => t.route.length === 2)).toBe(true)
  expect(s.stats.busLengths[0].skewMm).toBeCloseTo(2, 7)
})

test("pair-only matching uses core lengthTolerance without exact equality", () => {
  const j = input()
  j.buses = []
  j.differentialPairs = [{ connectionNames: ["a", "b"], lengthTolerance: 0.5 }]
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.solved).toBe(true)
  expect(s.stats.pairLengths[0].matched).toBe(true)
  expect(s.stats.pairLengths[0].skewMm).toBeCloseTo(0.5, 7)
  expect(s.stats.pairLengths[0].lengths[1].totalLengthMm).toBeCloseTo(9.5, 7)
  j.differentialPairs[0].lengthTolerance = 2
  const unchanged = new BusLanesSolver(j)
  unchanged.solve()
  expect(unchanged.solved).toBe(true)
  expect(unchanged.traces.every((t) => t.route.length === 2)).toBe(true)
})

test("overlapping bus and pair constraints keep independent tolerances", () => {
  const j = input()
  j.connections.push({
    name: "c",
    pointsToConnect: [
      { x: 0, y: 4, layer: "top" },
      { x: 6, y: 4, layer: "top" },
    ],
  })
  j.buses![0].maxLengthSkew = 1
  j.differentialPairs = [{ connectionNames: ["b", "c"], lengthTolerance: 0.5 }]
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.solved).toBe(true)
  expect(s.stats.busLengths[0].skewMm).toBeCloseTo(1, 7)
  expect(s.stats.pairLengths[0].skewMm).toBeCloseTo(0.5, 7)
  const lengths = s.stats.traceLengthsMm
    .map((t: { length: number }) => t.length)
    .sort((a: number, b: number) => a - b)
  for (const [i, expected] of [8.5, 9, 10].entries())
    expect(lengths[i]).toBeCloseTo(expected, 7)
})

test("invalid pair tolerances and unknown pair members fail explicitly", () => {
  for (const tolerance of [-1, NaN, Infinity]) {
    const j = input()
    j.differentialPairs = [
      { connectionNames: ["a", "b"], lengthTolerance: tolerance },
    ]
    const s = new BusLanesSolver(j)
    s.solve()
    expect(s.failed).toBe(true)
  }
  const j = input()
  j.differentialPairs = [
    { connectionNames: ["a", "missing"], lengthTolerance: 1 },
  ]
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.failed).toBe(true)
})
