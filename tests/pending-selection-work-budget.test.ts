import { expect, test } from "bun:test"
import { PendingRoutingWorkBudgetExceeded } from "../lib/routing-memory-budget"
import { runBoundedRouting } from "../lib/run-bounded-routing"
import { solveSignalCandidatePoolSteps } from "../lib/solve-signal-candidate-pool"

function drain<T>(search: Generator<unknown, T>): T {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

test("an exhaustive pending selection failure exactly at the cap remains finite", () => {
  let checked = 0
  let exhausted = 0
  const answer = drain(
    solveSignalCandidatePoolSteps({
      domains: [[1]],
      compatible: () => true,
      maxSearchNodes: 2,
      acceptSelection: function* () {
        checked++
        return false
      },
      onSearchExhausted: () => {
        exhausted++
        return new PendingRoutingWorkBudgetExceeded()
      },
    }),
  )
  expect(answer).toBeNull()
  expect(checked).toBe(1)
  expect(exhausted).toBe(0)
})

test("skipped pending selections remain unknown while a larger existing budget reaches the valid choice", () => {
  const checked: number[] = []
  const search = () =>
    solveSignalCandidatePoolSteps({
      domains: [[1, 2]],
      compatible: () => true,
      maxSearchNodes: 2,
      acceptSelection: function* (selection) {
        checked.push(selection[0])
        return selection[0] === 2
      },
      onSearchExhausted: () => new PendingRoutingWorkBudgetExceeded(),
    })
  expect(() => drain(search())).toThrow(PendingRoutingWorkBudgetExceeded)
  expect(checked).toEqual([1])
  expect(
    drain(
      solveSignalCandidatePoolSteps({
        domains: [[1, 2]],
        compatible: () => true,
        maxSearchNodes: 3,
        acceptSelection: function* (selection) {
          return selection[0] === 2
        },
        onSearchExhausted: () => new PendingRoutingWorkBudgetExceeded(),
      }),
    ),
  ).toEqual([2])
})

test("a selection cap before a complete choice is unknown only with the explicit policy", () => {
  let checked = 0
  const options = {
    domains: [[1]],
    compatible: () => true,
    maxSearchNodes: 1,
    acceptSelection: function* () {
      checked++
      return true
    },
  }
  expect(drain(solveSignalCandidatePoolSteps(options))).toBeNull()
  expect(checked).toBe(0)
  expect(() =>
    drain(
      solveSignalCandidatePoolSteps({
        ...options,
        onSearchExhausted: () => new PendingRoutingWorkBudgetExceeded(),
      }),
    ),
  ).toThrow(PendingRoutingWorkBudgetExceeded)
  expect(checked).toBe(0)
})

test("cancelling a cooperative selection closes its predicate without exhausting or publishing it", () => {
  let closed = false
  let exhausted = 0
  const selection = solveSignalCandidatePoolSteps({
    domains: [[1]],
    compatible: () => true,
    maxSearchNodes: 2,
    acceptSelection: function* () {
      try {
        yield
        return true
      } finally {
        closed = true
      }
    },
    onSearchExhausted: () => {
      exhausted++
      return new PendingRoutingWorkBudgetExceeded()
    },
  })
  expect(selection.next().done).toBe(false)
  expect(selection.return(null)).toEqual({ done: true, value: null })
  expect(closed).toBe(true)
  expect(exhausted).toBe(0)
})

test("strict yield limits preserve exact completion and natural failure at the boundary", () => {
  let exhausted = 0
  const limit = {
    maxSteps: 1,
    onExhausted: () => {
      exhausted++
      return new PendingRoutingWorkBudgetExceeded()
    },
  }
  function* complete() {
    yield
    return "complete"
  }
  function* finiteFailure() {
    yield
    return null
  }
  expect(drain(runBoundedRouting(complete(), limit))).toBe("complete")
  expect(drain(runBoundedRouting(finiteFailure(), limit))).toBeNull()
  expect(exhausted).toBe(0)
})

test("strict yield exhaustion closes the unfinished child and retains its resource class", () => {
  let closed = false
  function* child() {
    try {
      yield
      yield
      return "complete"
    } finally {
      closed = true
    }
  }
  expect(() =>
    drain(
      runBoundedRouting(child(), {
        maxSteps: 1,
        onExhausted: () => new PendingRoutingWorkBudgetExceeded(),
      }),
    ),
  ).toThrow(PendingRoutingWorkBudgetExceeded)
  expect(closed).toBe(true)
})

test("cancelling a strict yield limiter closes its child without invoking exhaustion", () => {
  let closed = false
  let exhausted = 0
  function* child() {
    try {
      yield
      yield
      return "complete"
    } finally {
      closed = true
    }
  }
  const search = runBoundedRouting(child(), {
    maxSteps: 1,
    onExhausted: () => {
      exhausted++
      return new PendingRoutingWorkBudgetExceeded()
    },
  })
  expect(search.next().done).toBe(false)
  expect(search.return(null)).toEqual({ done: true, value: null })
  expect(closed).toBe(true)
  expect(exhausted).toBe(0)
})
