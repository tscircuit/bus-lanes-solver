import { expect, test } from "bun:test"
import { offsetPath, routeCoupledPair } from "../lib/coupled-pair-routing"
import { segmentDistance } from "../lib/geometry"
import { pairCouplingReports } from "../lib/pair-coupling"
import { reduceOrdinaryTurns } from "../lib/reduce-ordinary-turns"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { pairLengthReports } from "../lib/route-lengths"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import type { Point, SimpleRouteJson, Trace } from "../lib/types"
import { VectorScene } from "../lib/vector-scene"
import { connectors } from "../lib/vector-visibility"

// Retain the original decimals: rounding can change connector tie-breaking.
// Only the corridor endpoints come from AM3352; the empty scene is synthetic.
const ends: [Point, Point] = [
  { x: 39.03105969999999, y: -15.000126000000002 },
  { x: 39.4650233, y: -14.99924 },
]
const width = 0.1
const gap = 0.18
const clearance = 0.1
const offset = (width + gap) / 2
// routeCoupledPair moves each handoff inward by this native margin.
const approach = 2 * width + gap + clearance
const input: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: width,
  minTraceToPadEdgeClearance: clearance,
  bounds: { minX: 38, maxX: 41, minY: -17, maxY: -13 },
  obstacles: [],
  connections: ["P", "N"].map((name, side) => ({
    name,
    pointsToConnect: ends.map((point, end) => ({
      x: point.x + (end === 0 ? -approach : approach),
      y: point.y + (side === 0 ? offset : -offset),
      layer: "top",
    })),
  })),
  differentialPairs: [
    {
      connectionNames: ["P", "N"],
      traceGap: gap,
      lengthTolerance: 0.127,
      maxUncoupledLength: 1,
    },
  ],
}
const scene = () =>
  new VectorScene(
    input,
    {
      name: "pair_corridor",
      pointsToConnect: ends.map((point) => ({ ...point, layer: "top" })),
    },
    2 * width + gap,
    [],
  )
const asTrace = (points: Point[]): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: "offset-control",
  route: points.map((point) => ({
    ...point,
    route_type: "wire",
    layer: "top",
    width,
  })),
})
const rails = (points: Point[]) =>
  [offset, -offset].map((amount) => asTrace(offsetPath(points, amount)))

test("control: the centered connector has two valid offset conductors", () => {
  const centered = connectors(...ends)[0]
  expect(centered).toHaveLength(4)
  expect(scene().pathVisible(centered)).toBe(true)
  expect(routeAnglesAreConventional(rails(centered))).toBe(true)
})

test("control: ordinary shortening alone is insufficient for this pair", () => {
  const reduced = reduceOrdinaryTurns(connectors(...ends)[0], scene())
  expect(reduced).toHaveLength(3)
  expect(scene().pathVisible(reduced)).toBe(true)
  // The negative offset reverses in X and forms a 135-degree corner.
  const negative = offsetPath(reduced, -offset)
  expect(negative[1].x).toBeLessThan(negative[0].x)
  expect(routeAnglesAreConventional(rails(reduced))).toBe(false)
})

test("coupled routing preserves this routable almost-horizontal corridor", () => {
  const generator = routeCoupledPair(input, input.differentialPairs![0], [])
  let traces: Trace[] | null | undefined
  try {
    for (let step = 0; step < 10_000; step++) {
      const result = generator.next()
      if (result.done) {
        traces = result.value
        break
      }
    }
  } finally {
    generator.return(null)
  }
  expect(traces).toBeDefined()
  // Regression: upstream returns null despite the valid centered alternative.
  expect(traces).not.toBeNull()
  if (!traces) return
  expect(traces).toHaveLength(2)
  expect(routeAnglesAreConventional(traces)).toBe(true)
  expect(sharedPairSpacingReports(input, traces)[0].matched).toBe(true)
  expect(pairCouplingReports(input, traces)[0].matched).toBe(true)
  expect(pairLengthReports(input, traces)[0].matched).toBe(true)

  for (const connection of input.connections) {
    const trace = traces.find(
      (trace) => trace.connection_name === connection.name,
    )!
    expect(trace).toBeDefined()
    for (const [point, terminal] of [
      [trace.route[0], connection.pointsToConnect[0]],
      [trace.route.at(-1)!, connection.pointsToConnect[1]],
    ]) {
      expect(point.x).toBe(terminal.x)
      expect(point.y).toBe(terminal.y)
    }
    for (const point of trace.route) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
      expect(point.route_type).toBe("wire")
      if (point.route_type !== "wire") throw Error("Unexpected via")
      expect(point.layer).toBe("top")
      expect(point.width).toBe(width)
    }
    // Independent heading check catches a reversing offset rail.
    const headings = trace.route
      .slice(1)
      .map((point, i) =>
        Math.atan2(point.y - trace.route[i].y, point.x - trace.route[i].x),
      )
    for (let i = 1; i < headings.length; i++) {
      const delta = headings[i] - headings[i - 1]
      const turn = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)))
      expect(turn).toBeLessThanOrEqual((45.2 * Math.PI) / 180)
    }
  }
  // Continuous separation between the two conductors, including approaches.
  for (let i = 1; i < traces[0].route.length; i++)
    for (let j = 1; j < traces[1].route.length; j++)
      expect(
        segmentDistance(
          [traces[0].route[i - 1], traces[0].route[i]],
          [traces[1].route[j - 1], traces[1].route[j]],
        ) - width,
      ).toBeGreaterThanOrEqual(clearance - 1e-8)
})
