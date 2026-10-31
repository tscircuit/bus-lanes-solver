import { expect, test } from "bun:test"
import { distance, length, segmentDistance } from "../../lib/geometry"
import { tuneCoupledLengths } from "../../lib/tune-coupled-lengths"
import type { SimpleRouteJson, Trace } from "../../lib/types"

// Board-world mm, +X right/+Y up. Measure emitted polylines, not ideal arcs.
test("a tight-gap pair can gain length without violating copper clearance", () => {
  const width = 0.089
  const gap = 0.089
  const spacing = width + gap
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
    const a = { x: 12.3, y: -8.2 }
    const b = { x: a.x + 8 * Math.cos(angle), y: a.y + 8 * Math.sin(angle) }
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) }
    const traces: Trace[] = ["P", "N"].map((name, rail) => ({
      type: "pcb_trace",
      pcb_trace_id: name,
      connection_name: name,
      coupledSection: [0, 1],
      route: [a, b].map((center) => ({
        route_type: "wire",
        layer: "inner1",
        width,
        x: center.x + (normal.x * (rail === 0 ? 1 : -1) * spacing) / 2,
        y: center.y + (normal.y * (rail === 0 ? 1 : -1) * spacing) / 2,
      })),
    }))
    const input: SimpleRouteJson = {
      bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
      layerCount: 6,
      minTraceWidth: width,
      minTraceToPadEdgeClearance: gap,
      obstacles: [],
      connections: traces.map((trace) => ({
        name: trace.connection_name!,
        pointsToConnect: trace.route.map((point) => ({
          ...point,
          layer: "inner1",
        })),
      })),
      buses: [
        {
          busId: "BYTE",
          connectionNames: ["P", "N"],
          minLength: 12,
          maxLengthSkew: 0.5,
        },
      ],
      differentialPairs: [
        { connectionNames: ["P", "N"], traceGap: gap, lengthTolerance: 0.1 },
      ],
    }
    const tuned = tuneCoupledLengths(input, traces, { packMeanders: true })
    for (const [rail, trace] of tuned.entries()) {
      expect(distance(trace.route[0], traces[rail].route[0])).toBeLessThan(1e-9)
      expect(
        distance(trace.route.at(-1)!, traces[rail].route.at(-1)!),
      ).toBeLessThan(1e-9)
      expect(Math.abs(length(trace.route) - 12)).toBeLessThan(1e-6)
    }
    let minimumSeparation = Infinity
    for (let i = 1; i < tuned[0].route.length; i++)
      for (let j = 1; j < tuned[1].route.length; j++) {
        minimumSeparation = Math.min(
          minimumSeparation,
          segmentDistance(
            [tuned[0].route[i - 1], tuned[0].route[i]],
            [tuned[1].route[j - 1], tuned[1].route[j]],
          ),
        )
      }
    expect(minimumSeparation - width).toBeGreaterThanOrEqual(gap - 1e-8)
  }
})
