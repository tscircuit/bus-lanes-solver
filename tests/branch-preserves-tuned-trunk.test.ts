import { expect, test } from "bun:test"
import { measureSignalPath } from "../lib/measure-signal-path"
import { trimBranchToTrunk } from "../lib/trim-branch-to-trunk"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("a termination branch cannot bypass the tuned primary path", () => {
  const from = { x: -2, y: 0, layer: "top" }
  const to = { x: 2, y: 0, layer: "top" }
  const terminal = { x: 0, y: 3, layer: "top" }
  const input: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 5 },
    obstacles: [],
    connections: [{ name: "clock", pointsToConnect: [from, to, terminal] }],
  }
  const trunk: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "trunk",
    connection_name: "clock",
    route: [from, { x: -4, y: 0 }, { x: -4, y: 2 }, { x: 2, y: 2 }, to].map(
      (point) => ({
        ...point,
        route_type: "wire",
        layer: "top",
        width: 0.1,
      }),
    ),
  }
  const branch: Trace = {
    ...trunk,
    pcb_trace_id: "branch",
    coupledSection: [1, 3],
    curvedSegments: [1, 2, 3],
    route: [from, { x: -2, y: -1 }, { x: 0, y: -1 }, terminal].map((point) => ({
      ...point,
      route_type: "wire",
      layer: "top",
      width: 0.1,
    })),
  }
  const original = structuredClone({ input, trunk, branch })
  const trimmed = trimBranchToTrunk({ input, branch, trunk: [trunk] })
  expect(
    measureSignalPath({
      input,
      traces: [trunk, branch],
      connectionName: "clock",
      from,
      to,
    }),
  ).toBe(10)
  expect(
    measureSignalPath({
      input,
      traces: [trunk, trimmed],
      connectionName: "clock",
      from,
      to,
    }),
  ).toBe(12)
  expect(
    measureSignalPath({
      input,
      traces: [trunk, trimmed],
      connectionName: "clock",
      from: terminal,
      to,
    }),
  ).toBe(5)
  expect(trimmed.coupledSection).toEqual([0, 1])
  expect(trimmed.curvedSegments).toEqual([1])
  expect({ input, trunk, branch }).toEqual(original)
})
