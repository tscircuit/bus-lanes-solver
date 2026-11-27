import { expect, test } from "bun:test"
import { RouteCandidatePool } from "../lib/select-route-candidates"
import { length } from "../lib/geometry"
import type { Trace } from "../lib/types"

test("matching targets guide carrier choices without excluding shorter clear paths", () => {
  const short: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "short",
    connection_name: "data",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const longer: Trace = {
    ...short,
    pcb_trace_id: "longer",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: 3, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const blocker: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "blocker",
    connection_name: "other",
    route: [
      { route_type: "wire", x: 1, y: 0.5, layer: "top", width: 0.1 },
      { route_type: "wire", x: 1, y: 2, layer: "top", width: 0.1 },
    ],
  }
  const pool = new RouteCandidatePool(0.1)
  pool.add("data", [short])
  pool.add("data", [longer])
  expect(length(pool.select(["data"])![0].route)).toBe(3)
  pool.setLengthTargets(new Map([["data", 6]]))
  expect(length(pool.select(["data"])![0].route)).toBe(5)
  pool.add("other", [blocker])
  expect(length(pool.select(["data", "other"])![0].route)).toBe(3)
  pool.setLengthTargets(new Map())
  expect(length(pool.select(["data"])![0].route)).toBe(3)
})
