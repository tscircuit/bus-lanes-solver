import { pointSegmentDistance } from "../lib/geometry"
import { expect, test } from "bun:test"
import { BusLanesSolver, resolveBusWidth, type SimpleRouteJson } from "../lib"
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
  expect(s.stats.traceLengthsMm[0].length).toBeCloseTo(
    s.stats.traceLengthsMm[1].length,
    7,
  )
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
test("uses impedance profile, rejects missing profiles and conflicting explicit widths", () => {
  const bus = {
    busId: "DATA",
    connectionNames: ["a"],
    targetImpedance: 50,
    impedanceProfile: {
      layer: "top",
      points: [
        { traceWidth: 0.1, impedance: 60 },
        { traceWidth: 0.2, impedance: 40 },
      ],
    },
  }
  expect(resolveBusWidth(bus, "top")).toBeCloseTo(0.15)
  expect(() => resolveBusWidth({ ...bus, traceWidth: 0.2 }, "top")).toThrow()
  expect(() =>
    resolveBusWidth({ ...bus, impedanceProfile: undefined }, "top"),
  ).toThrow()
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
