import { expect, test } from "bun:test"
import { finishSurfaceTiming } from "../lib/finish-surface-timing"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import { busLengthReports } from "../lib/route-lengths"
import { PendingRoutingWorkBudgetExceeded } from "../lib/routing-memory-budget"
import type { SimpleRouteJson, Trace } from "../lib/types"

function fixture(): FlexibleSignalState {
  const native: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    traces: [],
    connections: [
      {
        name: "CURRENT",
        width: 0.1,
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "TIMED",
        connectionNames: ["CURRENT"],
        minLength: 6,
        maxLengthSkew: 0.1,
      },
    ],
    pendingRoutingAccess: [
      {
        minTraceWidth: 0.1,
        bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
        connections: [
          {
            name: "LATER",
            width: 0.1,
            pointsToConnect: [
              { x: -2, y: 2, layer: "top" },
              { x: 2, y: 2, layer: "top" },
            ],
          },
        ],
      },
    ],
  }
  const seed: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "current",
    connection_name: "CURRENT",
    route: [
      { x: -2, y: 0, route_type: "wire", layer: "top", width: 0.1 },
      { x: 2, y: 0, route_type: "wire", layer: "top", width: 0.1 },
    ],
  }
  return { native, pending: native, traces: [seed], escapes: [], retained: [] }
}

function drain<T>(search: Generator<unknown, T>): T {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

test("unfinished pending timing refinement retains UNKNOWN and leaves its input intact", () => {
  const previous = fixture()
  const original = structuredClone(previous)
  expect(
    busLengthReports(previous.native, previous.traces)[0].aboveMinimumLength,
  ).toBe(false)
  expect(() =>
    drain(
      finishSurfaceTiming(
        previous,
        {},
        {
          preserveTiming: true,
          maxSteps: 1,
        },
      ),
    ),
  ).toThrow(PendingRoutingWorkBudgetExceeded)
  expect(previous).toEqual(original)
})

test("the same physical timing problem completes under its existing larger budget", () => {
  const previous = fixture()
  const original = structuredClone(previous)
  const result = drain(
    finishSurfaceTiming(
      previous,
      {},
      {
        preserveTiming: true,
        maxSteps: 2000,
      },
    ),
  )
  expect(result).not.toBeNull()
  if (!result) return
  expect(result.traces).toHaveLength(1)
  expect(
    busLengthReports(previous.native, result.traces).map((report) => ({
      aboveMinimumLength: report.aboveMinimumLength,
      withinLengthLimit: report.withinLengthLimit,
      matched: report.matched,
    })),
  ).toEqual([
    { aboveMinimumLength: true, withinLengthLimit: true, matched: true },
  ])
  expect(result.traces[0].route[0]).toMatchObject({
    x: -2,
    y: 0,
    layer: "top",
    width: 0.1,
  })
  expect(result.traces[0].route.at(-1)).toMatchObject({
    x: 2,
    y: 0,
    layer: "top",
    width: 0.1,
  })
  expect(previous).toEqual(original)
})

test("the same limited finisher without pending intent retains its legacy null result", () => {
  const previous = fixture()
  delete previous.native.pendingRoutingAccess
  const original = structuredClone(previous)
  expect(
    drain(
      finishSurfaceTiming(
        previous,
        {},
        {
          preserveTiming: true,
          maxSteps: 1,
        },
      ),
    ),
  ).toBeNull()
  expect(previous).toEqual(original)
})

test("cancelling pending finishing publishes no route and leaves the physical source intact", () => {
  const previous = fixture()
  const original = structuredClone(previous)
  const search = finishSurfaceTiming(
    previous,
    {},
    { preserveTiming: true, maxSteps: 1 },
  )
  expect(search.next().done).toBe(false)
  expect(search.return(null)).toEqual({ done: true, value: null })
  const closed = search.next()
  expect(closed.done).toBe(true)
  expect(closed.value).toBeUndefined()
  expect(previous).toEqual(original)
})
