import { expect, test } from "bun:test"
import { CandidateSearchOutcomes } from "../lib/candidate-search-outcomes"
import {
  RoutingMemoryBudget,
  RoutingMemoryBudgetExceeded,
} from "../lib/routing-memory-budget"

function drain<T>(search: Generator<void, T>): T {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

test("an unknown candidate releases its branch so the next existing candidate can solve", () => {
  const memory = new RoutingMemoryBudget(128)
  const outcomes = new CandidateSearchOutcomes()
  const expected = { routed: "complete" }
  function* expensive(): Generator<void, typeof expected | null> {
    if (!memory.reserve(64)) throw new RoutingMemoryBudgetExceeded()
    try {
      yield
      if (!memory.reserve(128)) throw new RoutingMemoryBudgetExceeded()
      return null
    } finally {
      memory.release(64)
    }
  }
  function* valid(): Generator<void, typeof expected | null> {
    if (!memory.reserve(96)) throw new RoutingMemoryBudgetExceeded()
    try {
      yield
      return expected
    } finally {
      memory.release(96)
    }
  }

  let result: typeof expected | null = null
  for (const candidate of [expensive(), valid()]) {
    result = drain(outcomes.run(candidate))
    if (result) break
  }
  if (!result) outcomes.noSolution()
  expect(result).toBe(expected)
  expect(outcomes.unknownCount).toBe(1)
  expect(memory.usedBytes).toBe(0)
  expect(memory.peakBytes).toBe(96)
})

test("an all-unknown domain reports its last resource error instead of ordinary no-solution", () => {
  const outcomes = new CandidateSearchOutcomes()
  const errors = [
    new RoutingMemoryBudgetExceeded("first candidate"),
    new RoutingMemoryBudgetExceeded("last candidate"),
  ]
  for (const error of errors) {
    const search = function* (): Generator<void, string | null> {
      yield
      throw error
    }
    expect(drain(outcomes.run(search()))).toBeNull()
  }
  let failure: unknown
  try {
    outcomes.noSolution()
  } catch (error) {
    failure = error
  }
  expect(failure).toBe(errors[1])
  expect((failure as RoutingMemoryBudgetExceeded).code).toBe(
    "search_memory_budget_exhausted",
  )
  expect(outcomes.unknownCount).toBe(2)
})

test("an exhausted ordinary domain remains a normal no-solution", () => {
  const outcomes = new CandidateSearchOutcomes()
  const search = function* (): Generator<void, string | null> {
    yield
    return null
  }
  expect(drain(outcomes.run(search()))).toBeNull()
  expect(outcomes.noSolution()).toBeNull()
  expect(outcomes.unknownCount).toBe(0)
})

test("non-resource errors propagate and release branch state", () => {
  const memory = new RoutingMemoryBudget(128)
  const outcomes = new CandidateSearchOutcomes()
  const failure = new Error("invalid routing geometry")
  const search = function* (): Generator<void, string | null> {
    memory.reserve(64)
    try {
      yield
      throw failure
    } finally {
      memory.release(64)
    }
  }
  let received: unknown
  try {
    drain(outcomes.run(search()))
  } catch (error) {
    received = error
  }
  expect(received).toBe(failure)
  expect(outcomes.unknownCount).toBe(0)
  expect(memory.usedBytes).toBe(0)
})

test("cancelling a yielded candidate releases its owned state", () => {
  const memory = new RoutingMemoryBudget(128)
  const outcomes = new CandidateSearchOutcomes()
  const search = function* (): Generator<void, string | null> {
    memory.reserve(64)
    try {
      yield
      return "complete"
    } finally {
      memory.release(64)
    }
  }
  const candidate = outcomes.run(search())
  expect(candidate.next().done).toBe(false)
  expect(memory.usedBytes).toBe(64)
  expect(candidate.return(null)).toEqual({ done: true, value: null })
  expect(memory.usedBytes).toBe(0)
  expect(outcomes.unknownCount).toBe(0)
})
