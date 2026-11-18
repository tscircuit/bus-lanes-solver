import { expect, test } from "bun:test"
import { pendingClosureFragments } from "../lib/pending-closure-fragments"
import { solveSignalCandidatePoolSteps } from "../lib/solve-signal-candidate-pool"

function finish<Result>(search: Generator<void, Result>): Result {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

test("bounded release dimensions preserve joint choices without exceeding their declared allowance", () => {
  const component = [0, 1, 2, 3, 4, 5]
  const edges: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [1, 3],
    [3, 4],
    [4, 5],
  ]
  const original = structuredClone({ component, edges })
  for (const limit of [1, 2, 3])
    for (const maxFragments of [0, 1, 2, 3, 12]) {
      const fragments = [
        ...pendingClosureFragments({ component, edges, limit, maxFragments }),
      ]
      expect(fragments.length).toBeLessThanOrEqual(maxFragments)
      const keys = fragments.map((fragment) => [...fragment].sort().join(":"))
      expect(new Set(keys).size).toBe(keys.length)
      for (const fragment of fragments) {
        expect(fragment.length).toBeGreaterThan(0)
        expect(fragment.length).toBeLessThanOrEqual(limit)
        expect(new Set(fragment).size).toBe(fragment.length)
        expect(fragment.every((index) => component.includes(index))).toBe(true)
      }
      if (maxFragments)
        expect(fragments.some((fragment) => fragment.length === limit)).toBe(
          true,
        )
      if (maxFragments >= limit)
        for (let size = 1; size <= limit; size++)
          expect(fragments.some((fragment) => fragment.length === size)).toBe(
            true,
          )
      for (let index = 1; index < fragments.length; index++)
        expect(fragments[index].length).toBeGreaterThanOrEqual(
          fragments[index - 1].length,
        )
    }
  expect({ component, edges }).toEqual(original)
})

test("a small component retains every nonempty release including the full joint choice", () => {
  for (const component of [
    [2, 5],
    [2, 5, 9],
  ]) {
    const fragments = [
      ...pendingClosureFragments({
        component,
        edges: [
          [2, 5],
          [5, 9],
        ],
        limit: 3,
      }),
    ]
    expect(fragments).toHaveLength(2 ** component.length - 1)
    expect(
      fragments.some((fragment) =>
        component.every((index) => fragment.includes(index)),
      ),
    ).toBe(true)
    expect(
      new Set(fragments.map((fragment) => [...fragment].sort().join(":"))).size,
    ).toBe(fragments.length)
  }
  const duplicateInput = [
    ...pendingClosureFragments({
      component: [1, 1, 2],
      edges: [[1, 2]],
      limit: 3,
    }),
  ]
  expect(
    duplicateInput.every(
      (fragment) => new Set(fragment).size === fragment.length,
    ),
  ).toBe(true)
})

test("the public candidate pool retains solutions requiring both variables to change", () => {
  const oldA = { id: "old_a", changed: false }
  const newA = { id: "new_a", changed: true }
  const oldB = { id: "old_b", changed: false }
  const newB = { id: "new_b", changed: true }
  const attempted: string[][] = []
  const result = finish(
    solveSignalCandidatePoolSteps({
      domains: [
        [oldA, newA],
        [oldB, newB],
      ],
      compatible: () => true,
      acceptSelection: function* (selection) {
        attempted.push(selection.map((value) => value.id))
        return selection.every((value) => value.changed)
      },
    }),
  )
  expect(result).toEqual([newA, newB])
  expect(result![0]).toBe(newA)
  expect(result![1]).toBe(newB)
  expect(
    attempted.some(
      (values) => values.includes("new_a") && values.includes("old_b"),
    ),
  ).toBe(true)
  expect(
    attempted.some(
      (values) => values.includes("old_a") && values.includes("new_b"),
    ),
  ).toBe(true)
})
