import { expect, test } from "bun:test"
import { RouteCandidatePool } from "../lib/select-route-candidates"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("prefers a compatible route that needs less tuning to reach its declared minimum", (): void => {
  const wire = { route_type: "wire" as const, layer: "top", width: 0.1 }
  const direct: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "signal",
    connection_name: "signal",
    route: [
      { ...wire, x: 0, y: 0 },
      { ...wire, x: 4, y: 0 },
    ],
  }
  const detour: Trace = {
    ...direct,
    route: [
      { ...wire, x: 0, y: 0 },
      { ...wire, x: 0, y: 1 },
      { ...wire, x: 4, y: 1 },
      { ...wire, x: 4, y: 0 },
    ],
  }
  const input: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -2, maxX: 5, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
    buses: [{ busId: "bus", connectionNames: ["signal"], minLength: 8 }],
    traces: [
      {
        ...direct,
        pcb_trace_id: "fixed_approach",
        route: [
          { ...wire, x: -2, y: 0 },
          { ...wire, x: 0, y: 0 },
        ],
      },
    ],
  }
  const candidates = new RouteCandidatePool({ input, clearance: 0.1 })
  candidates.add("signal", [direct])
  candidates.add("signal", [detour])
  expect(candidates.select(["signal"])).toEqual([detour])
})
