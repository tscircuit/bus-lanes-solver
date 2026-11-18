import { expect, test } from "bun:test"
import {
  RoutingMemoryBudget,
  RoutingMemoryBudgetExceeded,
} from "../lib/routing-memory-budget"

test("overlapping search allocations can release and reuse their shared byte budget", () => {
  const MiB = 1024 * 1024
  const budget = new RoutingMemoryBudget(32 * MiB)
  const raster = 8 * MiB
  const closedIndex = 12 * MiB
  const signatures = 4 * MiB
  const queue = 16 * MiB

  expect(budget.reserve(raster)).toBe(true)
  expect(budget.reserve(closedIndex)).toBe(true)
  expect(budget.reserve(signatures)).toBe(true)
  expect(budget.usedBytes).toBe(24 * MiB)
  budget.release(closedIndex)
  expect(budget.reserve(queue)).toBe(true)
  expect(budget.usedBytes).toBe(28 * MiB)
  expect(budget.peakBytes).toBe(28 * MiB)

  expect(budget.reserve(5 * MiB)).toBe(false)
  expect(budget.usedBytes).toBe(28 * MiB)
  expect(budget.peakBytes).toBe(28 * MiB)
  expect(budget.exhausted).toBe(true)
  budget.release(queue)
  expect(budget.reserve(20 * MiB)).toBe(true)
  expect(budget.usedBytes).toBe(budget.maxBytes)
  expect(budget.peakBytes).toBe(32 * MiB)

  budget.release(32 * MiB)
  expect(budget.usedBytes).toBe(0)
  expect(budget.peakBytes).toBe(32 * MiB)
  expect(budget.exhausted).toBe(true)
})

test("zero and exact-capacity reservations retain precise integer accounting", () => {
  const empty = new RoutingMemoryBudget(0)
  expect(empty.reserve(0)).toBe(true)
  expect(empty.reserve(1)).toBe(false)
  empty.release(0)
  expect(empty.usedBytes).toBe(0)
  expect(empty.peakBytes).toBe(0)

  const largestExact = new RoutingMemoryBudget(Number.MAX_SAFE_INTEGER)
  expect(largestExact.reserve(Number.MAX_SAFE_INTEGER)).toBe(true)
  expect(largestExact.reserve(1)).toBe(false)
  expect(largestExact.usedBytes).toBe(Number.MAX_SAFE_INTEGER)
  largestExact.release(Number.MAX_SAFE_INTEGER)
  expect(largestExact.usedBytes).toBe(0)
})

test("invalid byte counts and over-release fail without corrupting live allocations", () => {
  const invalid = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    0.25,
    Number.MAX_SAFE_INTEGER + 1,
  ]
  const budget = new RoutingMemoryBudget(128)
  expect(budget.reserve(64)).toBe(true)
  for (const bytes of invalid) {
    expect(() => new RoutingMemoryBudget(bytes)).toThrow(RangeError)
    expect(() => budget.reserve(bytes)).toThrow(RangeError)
    expect(() => budget.release(bytes)).toThrow(RangeError)
  }
  expect(() => budget.release(65)).toThrow(RangeError)
  expect(budget.usedBytes).toBe(64)
  expect(budget.peakBytes).toBe(64)
  expect(budget.exhausted).toBe(false)
  budget.release(64)
  expect(() => budget.release(1)).toThrow(RangeError)
  expect(budget.usedBytes).toBe(0)
})

test("memory exhaustion has a distinct error code for routing diagnostics", () => {
  const error = new RoutingMemoryBudgetExceeded(
    "candidate frontier exceeded 32 MiB",
  )
  expect(error).toBeInstanceOf(Error)
  expect(error.name).toBe("RoutingMemoryBudgetExceeded")
  expect(error.code).toBe("search_memory_budget_exhausted")
  expect(error.message).toBe("candidate frontier exceeded 32 MiB")
})
