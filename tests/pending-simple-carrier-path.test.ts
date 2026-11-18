import { expect, test } from "bun:test"
import {
  findSimpleCarrierPath,
  type PendingCarrierGraphEdge,
} from "../lib/pending-simple-carrier-path"
import { RoutingMemoryBudgetExceeded } from "../lib/routing-memory-budget"

interface Step {
  from: number
  to: number
  carrier: boolean
  length: number
  name: string
}

type Edge = readonly [number, number, boolean?, number?]

function graph(nodeCount: number, edges: readonly Edge[]) {
  const adjacent: PendingCarrierGraphEdge<Step>[][] = Array.from(
    { length: nodeCount },
    () => [],
  )
  for (const [
    index,
    [from, to, carrier = false, length = 1],
  ] of edges.entries()) {
    const step = { from, to, carrier, length, name: `edge_${index}` }
    adjacent[from].push({ other: to, step })
    adjacent[to].push({ other: from, step: { ...step, from: to, to: from } })
  }
  return {
    nodeCount,
    neighbors: (node: number) => adjacent[node],
    isCarrier: (step: Step) => step.carrier && step.length > 0,
    reverseStep: (step: Step): Step => ({
      ...step,
      from: step.to,
      to: step.from,
    }),
  }
}

function finish<Result>(search: Generator<void, Result>): Result {
  let result = search.next()
  while (!result.done) result = search.next()
  return result.value
}

function verifyPath(request: {
  path: Step[]
  sourceNodes: readonly number[]
  targetNodes: readonly number[]
}): void {
  const { path, sourceNodes, targetNodes } = request
  expect(path.length).toBeGreaterThan(0)
  expect(sourceNodes.includes(path[0].from)).toBe(true)
  expect(targetNodes.includes(path.at(-1)!.to)).toBe(true)
  expect(path.some((step) => step.carrier && step.length > 0)).toBe(true)
  const visited = new Set([path[0].from])
  for (const [index, step] of path.entries()) {
    if (index) expect(step.from).toBe(path[index - 1].to)
    expect(visited.has(step.to)).toBe(false)
    visited.add(step.to)
    if (index) expect(sourceNodes.includes(step.from)).toBe(false)
    if (index < path.length - 1)
      expect(targetNodes.includes(step.to)).toBe(false)
  }
}

test("a carrier spur or a carrier cycle attached at one articulation does not connect the peers", () => {
  for (const input of [
    graph(4, [
      [0, 1],
      [1, 2],
      [1, 3, true],
    ]),
    graph(5, [
      [0, 1],
      [1, 2],
      [1, 3],
      [3, 4, true],
      [4, 1],
    ]),
  ])
    expect(
      finish(
        findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [2] }),
      ),
    ).toBeUndefined()
})

test("a real carrier path remains available alongside a shorter native path", () => {
  const input = graph(5, [
    [0, 1],
    [1, 2],
    [0, 3],
    [3, 4, true],
    [4, 2],
  ])
  const result = finish(
    findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [2] }),
  )
  expect(result).toBeDefined()
  verifyPath({ path: result!.steps, sourceNodes: [0], targetNodes: [2] })
})

test("the second flow arm can reroute the first greedy arm to keep the paths disjoint", () => {
  const input = graph(6, [
    [0, 2],
    [2, 4],
    [0, 3],
    [3, 5],
    [1, 2],
    [4, 5, true],
  ])
  const result = finish(
    findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [1] }),
  )
  expect(result).toBeDefined()
  verifyPath({ path: result!.steps, sourceNodes: [0], targetNodes: [1] })
  expect(result!.steps.map((step) => step.from)).toEqual([0, 3, 5, 4, 2])
})

test("native-layer aliases are one physical endpoint rather than an artificial carrier excursion", () => {
  const spur = graph(5, [
    [0, 2],
    [2, 4],
    [1, 3, true],
    [3, 0],
  ])
  expect(
    finish(
      findSimpleCarrierPath({ ...spur, sourceNodes: [0, 1], targetNodes: [4] }),
    ),
  ).toBeUndefined()
  const targetSpur = graph(6, [
    [0, 1],
    [1, 4],
    [5, 2],
    [2, 3, true],
    [3, 4],
  ])
  expect(
    finish(
      findSimpleCarrierPath({
        ...targetSpur,
        sourceNodes: [0],
        targetNodes: [4, 5],
      }),
    ),
  ).toBeUndefined()
  const valid = graph(6, [
    [0, 2],
    [2, 4],
    [1, 3, true],
    [3, 5],
  ])
  const result = finish(
    findSimpleCarrierPath({
      ...valid,
      sourceNodes: [0, 1],
      targetNodes: [4, 5],
    }),
  )
  expect(result).toBeDefined()
  verifyPath({ path: result!.steps, sourceNodes: [0, 1], targetNodes: [4, 5] })
})

test("parallel carrier edges and an edge touching an endpoint retain their actual physical steps", () => {
  const input = graph(3, [
    [0, 1],
    [0, 1, true],
    [1, 2],
  ])
  const result = finish(
    findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [2] }),
  )
  expect(result).toBeDefined()
  verifyPath({ path: result!.steps, sourceNodes: [0], targetNodes: [2] })
  expect(result!.steps.some((step) => step.name === "edge_1")).toBe(true)
  const direct = graph(2, [[0, 1, true]])
  const one = finish(
    findSimpleCarrierPath({ ...direct, sourceNodes: [0], targetNodes: [1] }),
  )
  expect(one?.steps).toHaveLength(1)
  verifyPath({ path: one!.steps, sourceNodes: [0], targetNodes: [1] })
})

test("zero-length and transition-only participation is controlled by the physical caller", () => {
  const input = graph(3, [
    [0, 1, true, 0],
    [1, 2],
  ])
  expect(
    finish(
      findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [2] }),
    ),
  ).toBeUndefined()
  expect(
    finish(
      findSimpleCarrierPath({
        ...input,
        sourceNodes: [0, 1],
        targetNodes: [1, 2],
      }),
    ),
  ).toBeUndefined()
})

test("a missing terminal or disconnected carrier does not invent a path", () => {
  const input = graph(5, [
    [0, 1],
    [1, 2],
    [3, 4, true],
  ])
  expect(
    finish(
      findSimpleCarrierPath({ ...input, sourceNodes: [], targetNodes: [2] }),
    ),
  ).toBeUndefined()
  expect(
    finish(
      findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [2] }),
    ),
  ).toBeUndefined()
  expect(
    finish(
      findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [4] }),
    ),
  ).toBeUndefined()
})

test("dense work is bounded before allocation or graph traversal and real unknown errors propagate", () => {
  let calls = 0
  expect(() =>
    finish(
      findSimpleCarrierPath({
        ...graph(1, []),
        nodeCount: 10_000_000,
        sourceNodes: [0],
        targetNodes: [1],
        neighbors: () => {
          calls++
          return []
        },
      }),
    ),
  ).toThrow(RoutingMemoryBudgetExceeded)
  expect(calls).toBe(0)
  const unknown = new RoutingMemoryBudgetExceeded(
    "actual graph work unavailable",
  )
  expect(() =>
    finish(
      findSimpleCarrierPath({
        ...graph(2, []),
        sourceNodes: [0],
        targetNodes: [1],
        neighbors: () => {
          throw unknown
        },
      }),
    ),
  ).toThrow(unknown)
})

test("a yielded search can be cancelled without retaining a graph iterator or mutating the graph", () => {
  const input = graph(
    1000,
    Array.from(
      { length: 999 },
      (_, index): Edge => [index, index + 1, index === 998],
    ),
  )
  const original = JSON.stringify(
    Array.from({ length: input.nodeCount }, (_, node) => input.neighbors(node)),
  )
  let active = 0
  const neighbors = function* (node: number) {
    active++
    try {
      yield* input.neighbors(node)
    } finally {
      active--
    }
  }
  const request = { ...input, neighbors, sourceNodes: [0], targetNodes: [999] }
  const cancelled = findSimpleCarrierPath(request)
  expect(cancelled.next().done).toBe(false)
  cancelled.return(undefined)
  expect(active).toBe(0)
  const result = finish(findSimpleCarrierPath(request))
  expect(result?.steps).toHaveLength(999)
  expect(active).toBe(0)
  expect(
    JSON.stringify(
      Array.from({ length: input.nodeCount }, (_, node) =>
        input.neighbors(node),
      ),
    ),
  ).toBe(original)
})

test("a carrier block off the endpoint chain cannot hide a later real carrier block", () => {
  const input = graph(7, [
    [0, 1],
    [1, 2],
    [1, 3, true],
    [1, 4],
    [4, 5, true],
    [5, 6],
    [6, 2],
  ])
  const result = finish(
    findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [2] }),
  )
  expect(result).toBeDefined()
  verifyPath({ path: result!.steps, sourceNodes: [0], targetNodes: [2] })
  expect(result!.steps.some((step) => step.name === "edge_2")).toBe(false)
  expect(result!.steps.some((step) => step.name === "edge_4")).toBe(true)
})

test("a large off-chain carrier block needs linear graph traversal rather than flow per edge", () => {
  const side = 50
  const edges: Edge[] = [
    [0, 1],
    [1, 2],
    [1, 3],
  ]
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const node = 3 + x + y * side
      if (x + 1 < side) edges.push([node, node + 1, true])
      if (y + 1 < side) edges.push([node, node + side, true])
    }
  const input = graph(3 + side ** 2, edges)
  let neighborCalls = 0
  const result = finish(
    findSimpleCarrierPath({
      ...input,
      sourceNodes: [0],
      targetNodes: [2],
      neighbors: (node) => {
        neighborCalls++
        return input.neighbors(node)
      },
    }),
  )
  expect(result).toBeUndefined()
  expect(neighborCalls).toBeLessThan(input.nodeCount * 20)
})

test("cancelling the compact block DFS closes its one live iterator", () => {
  const input = graph(1000, [
    [0, 1],
    [1, 2],
    ...Array.from(
      { length: 997 },
      (_, index): Edge => [index === 0 ? 1 : index + 2, index + 3, true],
    ),
  ])
  let active = 0
  let maximumActive = 0
  let sourceCalls = 0
  const neighbors = function* (node: number) {
    active++
    maximumActive = Math.max(maximumActive, active)
    if (node === 0) sourceCalls++
    try {
      yield* input.neighbors(node)
    } finally {
      active--
    }
  }
  const search = findSimpleCarrierPath({
    ...input,
    neighbors,
    sourceNodes: [0],
    targetNodes: [2],
  })
  let step = search.next()
  while (!step.done && sourceCalls < 2) step = search.next()
  expect(step.done).toBe(false)
  expect(sourceCalls).toBeGreaterThanOrEqual(2)
  search.return(undefined)
  expect(active).toBe(0)
  expect(maximumActive).toBe(1)
})

test("a deep block search stays inside the same dense work envelope without retained iterator frames", () => {
  let active = 0
  let maximumActive = 0
  const neighbors = function* (
    node: number,
  ): Generator<PendingCarrierGraphEdge<Step>> {
    active++
    maximumActive = Math.max(maximumActive, active)
    try {
      const adjacent =
        node === 0
          ? [1]
          : node === 1
            ? [0, 2, 3]
            : node === 2
              ? [1]
              : node >= 3 && node <= 4096
                ? [
                    node === 3 ? 1 : node - 1,
                    ...(node < 4096 ? [node + 1] : []),
                  ]
                : []
      for (const other of adjacent)
        yield {
          other,
          step: {
            from: node,
            to: other,
            carrier: node >= 3 || other >= 3,
            length: 1,
            name: "bounded",
          },
        }
    } finally {
      active--
    }
  }
  expect(
    finish(
      findSimpleCarrierPath({
        ...graph(0, []),
        nodeCount: 2_200_000,
        neighbors,
        sourceNodes: [0],
        targetNodes: [2],
      }),
    ),
  ).toBeUndefined()
  expect(active).toBe(0)
  expect(maximumActive).toBe(1)
})

test("all five-node undirected graphs agree with independent simple-path enumeration", () => {
  const pairs: Array<readonly [number, number]> = []
  for (let from = 0; from < 5; from++)
    for (let to = from + 1; to < 5; to++) pairs.push([from, to])
  for (let mask = 1; mask < 2 ** pairs.length; mask++)
    for (const [carrierIndex, carrierPair] of pairs.entries()) {
      if (!(mask & (2 ** carrierIndex))) continue
      const edges = pairs.flatMap(([from, to], index): Edge[] =>
        mask & (2 ** index) ? [[from, to, index === carrierIndex]] : [],
      )
      const input = graph(5, edges)
      const visits = ({
        node,
        seen,
        usedCarrier,
      }: {
        node: number
        seen: number
        usedCarrier: boolean
      }): boolean => {
        if (node === 4) return usedCarrier
        return input.neighbors(node).some(
          ({ other, step }) =>
            !(seen & (2 ** other)) &&
            visits({
              node: other,
              seen: seen | (2 ** other),
              usedCarrier: usedCarrier || step.carrier,
            }),
        )
      }
      const expected = visits({ node: 0, seen: 1, usedCarrier: false })
      const result = finish(
        findSimpleCarrierPath({ ...input, sourceNodes: [0], targetNodes: [4] }),
      )
      if (!!result !== expected)
        throw Error(
          `Carrier path mismatch: mask=${mask}, edge=${carrierPair.join(":")}`,
        )
      expect(!!result).toBe(expected)
    }
})
