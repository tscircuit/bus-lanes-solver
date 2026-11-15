import { expect, test } from "bun:test"
import { refineRouteCandidates } from "../lib/refine-route-candidates"
import { RouteCandidatePool } from "../lib/select-route-candidates"
import { busLengthReports } from "../lib/route-lengths"
import type { SimpleRouteJson, Trace } from "../lib/types"

function refine(maxLength?: number, fixedLength = 0) {
  const input: SimpleRouteJson = {
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    obstacles: [],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -3, y: 0, layer: "bottom" },
          { x: 3, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -3, layer: "bottom" },
          { x: 0, y: 3, layer: "bottom" },
        ],
      },
    ],
  }
  input.buses = input.connections.map((c) => ({
    busId: c.name,
    connectionNames: [c.name],
    maxLength,
  }))
  if (fixedLength)
    input.traces = input.connections.map((c) => ({
      type: "pcb_trace",
      pcb_trace_id: `fixed_${c.name}`,
      connection_name: c.name,
      route: [
        { x: 20, y: 20, layer: "top", route_type: "wire", width: 0.1 },
        {
          x: 20 + fixedLength,
          y: 20,
          layer: "top",
          route_type: "wire",
          width: 0.1,
        },
      ],
    }))
  const before = JSON.stringify(input)
  const pool = new RouteCandidatePool(0.1)
  for (const c of input.connections)
    pool.add(c.name, [
      {
        type: "pcb_trace",
        pcb_trace_id: c.name,
        connection_name: c.name,
        route: c.pointsToConnect.map((p) => ({
          ...p,
          route_type: "wire",
          width: 0.1,
        })),
      },
    ])
  const names = input.connections.map((c) => c.name)
  const work = refineRouteCandidates(
    input,
    [],
    new Map(names.map((n) => [n, 0.1])),
    pool,
    names,
    names.map((n) => [n]),
    new Map(),
  )
  let step = work.next()
  while (!step.done) step = work.next()
  expect(JSON.stringify(input)).toBe(before)
  return { input, routes: step.value as Trace[] | null }
}

// Expected failures document the bug without leaving the reproduction PR red.
// The stacked fix must turn these into ordinary passing tests.
test.failing("refinement cannot detour crossing 6 mm nets within a 6 mm cap", () => {
  expect(refine(6).routes).toBeNull()
})

test.failing("refinement deducts immutable fanout length from the carrier budget", () => {
  expect(refine(7, 1).routes).toBeNull()
})

test("a generous total length cap permits a legal detour", () => {
  const { input, routes } = refine(12, 1)
  expect(routes).toHaveLength(2)
  expect(
    busLengthReports(input, routes!).every((b) => b.withinLengthLimit),
  ).toBe(true)
})

test("unbounded refinement still finds a detour", () => {
  expect(refine().routes).toHaveLength(2)
})
