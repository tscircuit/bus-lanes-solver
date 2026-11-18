import { expect, test } from "bun:test"
import {
  solveSignalCandidatePool,
  solveSignalCandidatePoolSteps,
} from "../lib/solve-signal-candidate-pool"

interface Candidate {
  id: string
  choice: number
}

function drain<T>(steps: Generator<void, T>): { result: T; yields: number } {
  let yields = 0
  let step = steps.next()
  while (!step.done) {
    yields++
    step = steps.next()
  }
  return { result: step.value, yields }
}

test("the unconstrained generator preserves synchronous selections, references and check order", () => {
  const a0 = { id: "a0", choice: 0 }
  const a1 = { id: "a1", choice: 1 }
  const b0 = { id: "b0", choice: 0 }
  const b1 = { id: "b1", choice: 1 }
  const c0 = { id: "c0", choice: 0 }
  const c1 = { id: "c1", choice: 1 }
  const mrvCompatible = (first: Candidate, second: Candidate) =>
    !((first === a0 && second === c0) || (first === c0 && second === a0))
  const cases: Array<{
    domains: Candidate[][]
    compatible: (first: Candidate, second: Candidate) => boolean
    expected: Candidate[] | null
    maxSearchNodes?: number
    maxSupportChecks?: number
    expectedChecks?: string[]
  }> = [
    {
      domains: [[a0, a1], [b0], [c0, c1]],
      compatible: mrvCompatible,
      expected: [a0, b0, c1],
    },
    {
      domains: [[a0, a1], [b0], [c0, c1]],
      compatible: mrvCompatible,
      expected: [a0, b0, c1],
      maxSupportChecks: 0,
      // Recorded from the original synchronous search before extraction.
      expectedChecks: ["b0:a0", "b0:a1", "b0:c0", "b0:c1", "a0:c0", "a0:c1"],
    },
    {
      domains: [
        [a0, a1],
        [b0, b1],
        [c0, c1],
      ],
      compatible: (first, second) => first.choice !== second.choice,
      expected: null,
    },
    {
      domains: [[a0], [b0]],
      compatible: () => false,
      expected: null,
    },
    {
      domains: [[a0], []],
      compatible: () => true,
      expected: null,
    },
    {
      domains: [],
      compatible: () => true,
      expected: [],
    },
    {
      domains: [[a0, a1], [b0], [c0, c1]],
      compatible: mrvCompatible,
      maxSearchNodes: 3,
      expected: null,
    },
  ]

  for (const entry of cases) {
    const syncChecks: string[] = []
    const asyncChecks: string[] = []
    const originalDomains = entry.domains.map((domain) => [...domain])
    const sync = solveSignalCandidatePool(
      entry.domains,
      (first, second) => {
        syncChecks.push(`${first.id}:${second.id}`)
        return entry.compatible(first, second)
      },
      entry.maxSearchNodes,
      entry.maxSupportChecks,
    )
    const { result } = drain(
      solveSignalCandidatePoolSteps({
        domains: entry.domains,
        compatible: (first, second) => {
          asyncChecks.push(`${first.id}:${second.id}`)
          return entry.compatible(first, second)
        },
        maxSearchNodes: entry.maxSearchNodes,
        maxSupportChecks: entry.maxSupportChecks,
      }),
    )

    expect(sync).toEqual(entry.expected)
    expect(result).toEqual(entry.expected)
    expect(asyncChecks).toEqual(syncChecks)
    if (entry.expectedChecks) expect(syncChecks).toEqual(entry.expectedChecks)
    for (let index = 0; index < (entry.expected?.length ?? 0); index++) {
      expect(sync![index]).toBe(entry.expected![index])
      expect(result![index]).toBe(entry.expected![index])
    }
    expect(entry.domains).toEqual(originalDomains)
  }
})

test("a rejected cheapest union resumes search at the next acceptable selection", () => {
  const a0 = { id: "a0", choice: 0 }
  const a1 = { id: "a1", choice: 1 }
  const b0 = { id: "b0", choice: 0 }
  const b1 = { id: "b1", choice: 1 }
  const attempts: Candidate[][] = []
  const steps = solveSignalCandidatePoolSteps({
    domains: [
      [a0, a1],
      [b0, b1],
    ],
    compatible: () => true,
    maxSearchNodes: 4000,
    maxSupportChecks: 1_000_000,
    acceptSelection: function* (selection) {
      attempts.push(selection)
      yield
      yield
      return selection.some((candidate) => candidate.choice === 1)
    },
  })

  const { result, yields } = drain(steps)
  expect(attempts).toEqual([
    [a0, b0],
    [a0, b1],
  ])
  expect(attempts[0][1]).toBe(b0)
  expect(result?.[0]).toBe(a0)
  expect(result?.[1]).toBe(b1)
  expect(yields).toBeGreaterThanOrEqual(4)
})

test("exhausted acceptance alternatives or search budget never accept a rejected union", () => {
  const a0 = { id: "a0", choice: 0 }
  const a1 = { id: "a1", choice: 1 }
  const b0 = { id: "b0", choice: 0 }
  const b1 = { id: "b1", choice: 1 }
  const domains = [
    [a0, a1],
    [b0, b1],
  ]
  const rejected: Candidate[][] = []
  const exhausted = drain(
    solveSignalCandidatePoolSteps({
      domains,
      compatible: () => true,
      maxSearchNodes: 4000,
      maxSupportChecks: 1_000_000,
      acceptSelection: function* (selection) {
        rejected.push(selection)
        yield
        return false
      },
    }),
  )
  expect(exhausted.result).toBeNull()
  expect(rejected).toEqual([
    [a0, b0],
    [a0, b1],
    [a1, b0],
    [a1, b1],
  ])
  expect(exhausted.yields).toBeGreaterThanOrEqual(4)

  let attempts = 0
  const bounded = drain(
    solveSignalCandidatePoolSteps({
      domains,
      compatible: () => true,
      maxSearchNodes: 3,
      maxSupportChecks: 1_000_000,
      acceptSelection: function* () {
        attempts++
        yield
        return attempts > 1
      },
    }),
  )
  expect(bounded.result).toBeNull()
  expect(attempts).toBe(1)
})
