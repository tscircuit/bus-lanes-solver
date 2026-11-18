import { expect, test } from "bun:test"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { routePendingAccess } from "../lib/route-pending-access"
import { PendingRoutingWorkBudgetExceeded } from "../lib/routing-memory-budget"
import { runBoundedRouting } from "../lib/run-bounded-routing"
import type { Trace } from "../lib/types"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

function fixture() {
  const { input, upperLeft, lowerRight } = pendingPadAccessFixture()
  const traces = [upperLeft, lowerRight]
  // Declare the current connection endpoints from the existing seed copper.
  // All original geometry, future constraints and supplied copper stay intact.
  input.connections = traces.map((trace) => ({
    name: trace.connection_name!,
    width: 0.1,
    pointsToConnect: [trace.route[0], trace.route.at(-1)!].map((point) => ({
      x: point.x,
      y: point.y,
      layer: "top",
    })),
  }))
  return { input, traces }
}

function drain<T>(search: Generator<unknown, T>): T {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

test("the collectively blocking repair is unfinished at the one-yield limit", () => {
  const { input, traces } = fixture()
  const original = structuredClone(input)
  const child = negotiateSurfaceRoutes(input, {
    native: input,
    pending: input,
    traces,
    retained: [],
    escapes: [],
  })
  try {
    expect(child.next().done).toBe(false)
    expect(child.next().done).toBe(false)
  } finally {
    child.return(null)
  }
  expect(input).toEqual(original)
})

test("pending repair exhaustion stays unknown and publishes no partial route or preserved report", () => {
  const { input, traces } = fixture()
  const original = structuredClone(input)
  const access = new PendingPadAccess(input)
  let output: Trace[] | null | undefined
  let failure: unknown
  try {
    output = drain(
      routePendingAccess({
        input,
        traces,
        options: {},
        maxSteps: 1,
        access,
      }),
    )
  } catch (error) {
    failure = error
  }
  expect(input).toEqual(original)
  expect(() => drain(access.getPreservedReport(traces))).toThrow(
    "Routing could not certify access for later connections",
  )
  expect(failure).toBeInstanceOf(PendingRoutingWorkBudgetExceeded)
  if (failure instanceof PendingRoutingWorkBudgetExceeded)
    expect(failure.code).toBe("search_expansion_budget_exhausted")
  expect(output).toBeUndefined()
})

test("the legacy numeric limiter still returns null and closes an unfinished child", () => {
  let closed = false
  function* child(): Generator<void, string> {
    try {
      yield
      yield
      return "complete"
    } finally {
      closed = true
    }
  }
  expect(drain(runBoundedRouting(child(), 1))).toBeNull()
  expect(closed).toBe(true)
})
