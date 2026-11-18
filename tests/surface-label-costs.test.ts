import { expect, test } from "bun:test"
import {
  RoutingMemoryBudget,
  RoutingMemoryBudgetExceeded,
} from "../lib/routing-memory-budget"
import { SurfaceLabelCosts } from "../lib/surface-label-costs"

test("cheaper but longer routes coexist until another route improves both costs", () => {
  const costs = new SurfaceLabelCosts({
    physicalStates: 16,
    memory: new RoutingMemoryBudget(4096),
  })
  const balanced = { id: 3, g: 10, routeLength: 10 }
  const cheaper = { id: 3, g: 8, routeLength: 12 }
  const shorter = { id: 3, g: 12, routeLength: 8 }
  for (const label of [balanced, cheaper, shorter]) costs.remember(label)

  for (const label of [balanced, cheaper, shorter])
    expect(costs.contains(label)).toBe(true)
  expect(costs.dominates({ id: 3, g: 11, routeLength: 11 })).toBe(true)
  expect(costs.dominates({ id: 3, g: 9, routeLength: 9 })).toBe(false)
  expect(
    costs.contains({ id: 3, g: 10 + 0.5e-9, routeLength: 10 - 0.5e-9 }),
  ).toBe(true)
  expect(costs.contains({ id: 3, g: 10 + 2e-9, routeLength: 10 })).toBe(false)

  costs.remember({ id: 3, g: 7, routeLength: 7 })
  for (const label of [balanced, cheaper, shorter]) {
    expect(costs.contains(label)).toBe(false)
    expect(costs.dominates(label)).toBe(true)
  }
})

test("physical states and homology signatures keep independent frontiers", () => {
  const costs = new SurfaceLabelCosts({
    physicalStates: 16,
    memory: new RoutingMemoryBudget(4096),
  })
  costs.remember({ id: 1, g: 1, routeLength: 1 })
  expect(costs.contains({ id: 1, signature: 0, g: 1, routeLength: 1 })).toBe(
    true,
  )
  expect(costs.dominates({ id: 1, signature: 1, g: 10, routeLength: 10 })).toBe(
    false,
  )
  expect(costs.dominates({ id: 2, g: 10, routeLength: 10 })).toBe(false)
  costs.remember({ id: 1, signature: 1, g: 10, routeLength: 10 })
  expect(costs.contains({ id: 1, signature: 1, g: 10, routeLength: 10 })).toBe(
    true,
  )
  expect(costs.contains({ id: 1, g: 10, routeLength: 10 })).toBe(false)
})

test("a frontier retains every affordable nondominated cost without a per-key cap", () => {
  const memory = new RoutingMemoryBudget(4096)
  const costs = new SurfaceLabelCosts({ physicalStates: 16, memory })
  const alternatives = Array.from({ length: 24 }, (_, index) => ({
    id: 3,
    g: 100 + index,
    routeLength: 80 - index,
  }))
  for (const label of alternatives) costs.remember(label)
  for (const label of alternatives) expect(costs.contains(label)).toBe(true)
  expect(memory.usedBytes).toBe(256 + 128 + 128 + 128 * 24)
})

test("remembered costs are independent of a mutable label and its parent payload", () => {
  const memory = new RoutingMemoryBudget(4096)
  const costs = new SurfaceLabelCosts({ physicalStates: 16, memory })
  const label = {
    id: 3,
    g: 10,
    routeLength: 20,
    parent: { payload: new Float64Array(1024) },
  }
  costs.remember(label)
  label.g = 0
  label.routeLength = 0
  label.parent.payload.fill(99)

  expect(costs.contains({ id: 3, g: 10, routeLength: 20 })).toBe(true)
  expect(costs.contains(label)).toBe(false)
  expect(costs.dominates({ id: 3, g: 1, routeLength: 1 })).toBe(false)
  expect(memory.usedBytes).toBe(256 + 128 + 128 + 128 * 24)
})

test("failed record allocation preserves the previous frontier and its memory charge", () => {
  const memory = new RoutingMemoryBudget(640)
  const costs = new SurfaceLabelCosts({ physicalStates: 16, memory })
  const old = Array.from({ length: 4 }, (_, index) => ({
    id: 3,
    g: 100 - index,
    routeLength: 20 + index,
  }))
  const alternate = { id: 3, g: 96, routeLength: 24 }
  for (const label of old) costs.remember(label)

  expect(() => costs.remember(alternate)).toThrow(RoutingMemoryBudgetExceeded)
  for (const label of old) expect(costs.contains(label)).toBe(true)
  expect(costs.contains(alternate)).toBe(false)
  expect(memory.usedBytes).toBe(256 + 128 + 128 + 4 * 24)
  expect(memory.peakBytes).toBe(memory.usedBytes)
  expect(memory.exhausted).toBe(true)
})

test("dominated records are reused without replacement allocations", () => {
  const memory = new RoutingMemoryBudget(640)
  const costs = new SurfaceLabelCosts({ physicalStates: 16, memory })
  expect(memory.usedBytes).toBe(256)
  costs.remember({ id: 3, g: 10, routeLength: 10 })
  expect(memory.usedBytes).toBe(608)
  costs.remember({ id: 3, g: 8, routeLength: 12 })
  costs.remember({ id: 3, g: 12, routeLength: 8 })
  costs.remember({ id: 3, g: 6, routeLength: 14 })
  expect(memory.usedBytes).toBe(608)
  // The first page is full. This replacement reuses one dominated record and
  // releases two more to the free list; neither operation allocates a buffer.
  costs.remember({ id: 3, g: 7, routeLength: 7 })
  costs.remember({ id: 3, g: 5, routeLength: 15 })
  costs.remember({ id: 3, g: 8, routeLength: 6 })
  expect(costs.contains({ id: 3, g: 7, routeLength: 7 })).toBe(true)
  expect(costs.contains({ id: 3, g: 6, routeLength: 14 })).toBe(true)
  expect(costs.contains({ id: 3, g: 5, routeLength: 15 })).toBe(true)
  expect(costs.contains({ id: 3, g: 8, routeLength: 6 })).toBe(true)
  costs.remember({ id: 3, g: 9, routeLength: 9 })
  expect(memory.usedBytes).toBe(608)
  expect(memory.peakBytes).toBe(608)
  expect(memory.exhausted).toBe(false)
})

test("a failed new-key reservation leaves every existing frontier unchanged", () => {
  const memory = new RoutingMemoryBudget(640)
  const costs = new SurfaceLabelCosts({ physicalStates: 16, memory })
  const old = { id: 3, g: 10, routeLength: 10 }
  costs.remember(old)
  expect(() => costs.remember({ id: 4, g: 1, routeLength: 1 })).toThrow(
    RoutingMemoryBudgetExceeded,
  )
  expect(costs.contains(old)).toBe(true)
  expect(costs.contains({ id: 4, g: 1, routeLength: 1 })).toBe(false)
  expect(memory.usedBytes).toBe(608)
})

test("a page-allocation failure rolls back a new key's provisional charge", () => {
  const memory = new RoutingMemoryBudget(864)
  const costs = new SurfaceLabelCosts({ physicalStates: 16, memory })
  const old = Array.from({ length: 8 }, (_, index) => ({
    id: 3,
    g: 100 - index,
    routeLength: 20 + index,
  }))
  for (const label of old) costs.remember(label)
  // The first page is full. A new map entry fits, but its first numeric record
  // does not; provisional accounting must be released with no frontier change.
  expect(memory.usedBytes).toBe(704)
  expect(() => costs.remember({ id: 4, g: 1, routeLength: 1 })).toThrow(
    RoutingMemoryBudgetExceeded,
  )
  for (const label of old) expect(costs.contains(label)).toBe(true)
  expect(costs.contains({ id: 4, g: 1, routeLength: 1 })).toBe(false)
  expect(memory.usedBytes).toBe(704)
  expect(memory.peakBytes).toBe(832)
  costs.dispose()
  expect(memory.usedBytes).toBe(0)
  expect(memory.exhausted).toBe(true)
})

test("numeric records span shared pages rather than allocating one buffer per key", () => {
  const memory = new RoutingMemoryBudget(1024 * 1024)
  const costs = new SurfaceLabelCosts({ physicalStates: 8192, memory })
  const count = 4100
  for (let id = 0; id < count; id++)
    costs.remember({ id, g: id, routeLength: id })
  for (const id of [0, 255, 256, 4095, 4096, 4099]) {
    expect(costs.contains({ id, g: id, routeLength: id })).toBe(true)
    expect(costs.dominates({ id, g: id + 1, routeLength: id + 1 })).toBe(true)
  }
  expect(memory.usedBytes).toBe(256 + count * 128 + 17 * (128 + 256 * 24))
})

test("unrepresentable state keys and unaffordable map allocation fail explicitly", () => {
  const memory = new RoutingMemoryBudget(4096)
  const costs = new SurfaceLabelCosts({ physicalStates: 16, memory })
  for (const label of [
    { id: 0, signature: Number.MAX_SAFE_INTEGER, g: 1, routeLength: 1 },
    { id: 16, signature: 0, g: 1, routeLength: 1 },
    { id: 0, signature: -1, g: 1, routeLength: 1 },
  ])
    expect(() => costs.remember(label)).toThrow(RoutingMemoryBudgetExceeded)
  expect(memory.usedBytes).toBe(256)

  const small = new RoutingMemoryBudget(255)
  expect(
    () => new SurfaceLabelCosts({ physicalStates: 16, memory: small }),
  ).toThrow(RoutingMemoryBudgetExceeded)
  expect(small.usedBytes).toBe(0)
})

test("disposal drops numeric pages and releases only the index's shared-budget ownership", () => {
  const memory = new RoutingMemoryBudget(4096)
  memory.reserve(64)
  const costs = new SurfaceLabelCosts({ physicalStates: 16, memory })
  costs.remember({ id: 3, g: 10, routeLength: 10 })
  costs.remember({ id: 4, g: 8, routeLength: 12 })
  expect(memory.usedBytes).toBeGreaterThan(64)
  const peak = memory.peakBytes

  costs.dispose()
  expect(memory.usedBytes).toBe(64)
  expect(memory.peakBytes).toBe(peak)
  costs.dispose()
  expect(memory.usedBytes).toBe(64)
  expect(() => costs.remember({ id: 3, g: 1, routeLength: 1 })).toThrow(
    "disposed",
  )
  memory.release(64)
  expect(memory.usedBytes).toBe(0)
})
