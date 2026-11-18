import { expect, test } from "bun:test"
import { OwnedCandidateMemo } from "../lib/owned-candidate-memo"

test("domain, current and best choices remain owned independently of result memo entries", () => {
  const domain = [{ name: "domain", route: [1, 2] }]
  const current = [{ name: "current", route: [3, 4] }]
  const best = [{ name: "best", route: [5, 6] }]
  const original = structuredClone({ domain, current, best })
  const memo = new OwnedCandidateMemo({
    maxBytes: 4096,
    retained: () => new Set([...domain, ...current, ...best]),
  })
  memo.set("domain", domain[0])
  memo.set("current", current[0])
  memo.set("best", best[0])

  expect(memo.get("domain")).toBe(domain[0])
  expect(memo.get("current")).toBe(current[0])
  expect(memo.get("best")).toBe(best[0])
  expect(memo.size).toBe(3)
  expect({ domain, current, best }).toEqual(original)
})

test("inactive memo values disappear without mutating choices, and set prunes inactive entries", () => {
  const first = { name: "first", route: [1, 2] }
  const second = { name: "second", route: [3, 4] }
  const retained = new Set([first, second])
  const memo = new OwnedCandidateMemo({
    maxBytes: 4096,
    retained: () => retained,
  })
  memo.set("first", first)
  memo.set("second", second)
  retained.delete(first)
  expect(memo.get("first")).toBeUndefined()
  expect(memo.get("second")).toBe(second)
  expect(memo.size).toBe(1)

  retained.delete(second)
  memo.set("ordinary failure", null)
  expect(memo.get("second")).toBeUndefined()
  expect(memo.get("ordinary failure")).toBeNull()
  memo.set("unowned", first)
  expect(memo.get("unowned")).toBeUndefined()
  expect(first).toEqual({ name: "first", route: [1, 2] })
  expect(second).toEqual({ name: "second", route: [3, 4] })
})

test("LRU eviction permits recomputation while preserving every routing choice", () => {
  const a = { name: "a" }
  const b = { name: "b" }
  const c = { name: "c" }
  const choices = new Set([a, b, c])
  const memo = new OwnedCandidateMemo({
    maxBytes: 276,
    retained: () => choices,
  })
  memo.set("a", a)
  memo.set("b", b)
  expect(memo.get("a")).toBe(a)
  memo.set("c", c)
  expect(memo.get("b")).toBeUndefined()
  expect(memo.get("a")).toBe(a)
  expect(memo.get("c")).toBe(c)
  expect(memo.usedBytes).toBe(276)

  memo.set("b", b)
  expect(memo.get("a")).toBeUndefined()
  expect(memo.get("b")).toBe(b)
  expect(memo.size).toBe(2)
  expect(choices).toEqual(new Set([a, b, c]))
})

test("null entries and UTF-16 keys remain inside the metadata byte allowance", () => {
  const memo = new OwnedCandidateMemo<object>({
    maxBytes: 278,
    retained: () => new Set(),
  })
  memo.set("a", null)
  memo.set("😀", null)
  expect(memo.usedBytes).toBe(138 + 140)
  expect(memo.size).toBe(2)
  memo.set("long", null)
  expect(memo.get("a")).toBeUndefined()
  expect(memo.get("😀")).toBeUndefined()
  expect(memo.get("long")).toBeNull()
  expect(memo.usedBytes).toBe(144)
  expect(memo.size).toBe(1)
})

test("oversized cache entries miss without rejecting or removing live candidates", () => {
  const a = { name: "a" }
  const b = { name: "b" }
  const choices = new Set([a, b])
  const memo = new OwnedCandidateMemo({
    maxBytes: 138,
    retained: () => choices,
  })
  memo.set("a", a)
  memo.set("oversized key", b)
  expect(memo.get("oversized key")).toBeUndefined()
  expect(memo.get("a")).toBe(a)
  expect(memo.usedBytes).toBe(138)
  expect(choices.has(b)).toBe(true)

  memo.set("a", null)
  expect(memo.get("a")).toBeNull()
  expect(memo.usedBytes).toBe(138)
  expect(memo.size).toBe(1)
})

test("disposal releases entries and stops consulting the choice owner", () => {
  const candidate = { name: "kept by domain" }
  let polls = 0
  const memo = new OwnedCandidateMemo({
    maxBytes: 4096,
    retained: () => {
      polls++
      return new Set([candidate])
    },
  })
  memo.set("candidate", candidate)
  const before = polls
  memo.dispose()
  memo.dispose()
  expect(memo.usedBytes).toBe(0)
  expect(memo.size).toBe(0)
  expect(memo.get("candidate")).toBeUndefined()
  memo.set("candidate", candidate)
  expect(memo.size).toBe(0)
  expect(polls).toBe(before)
})

test("invalid metadata allowances are rejected before the memo is used", () => {
  for (const maxBytes of [-1, 0.5, Infinity, Number.NaN]) {
    expect(
      () =>
        new OwnedCandidateMemo<object>({ maxBytes, retained: () => new Set() }),
    ).toThrow(RangeError)
  }
  const zero = new OwnedCandidateMemo<object>({
    maxBytes: 0,
    retained: () => new Set(),
  })
  zero.set("failure", null)
  expect(zero.get("failure")).toBeUndefined()
  expect(zero.usedBytes).toBe(0)
})
