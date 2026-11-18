import { expect, test } from "bun:test"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { CandidateSearchOutcomes } from "../lib/candidate-search-outcomes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingSurfaceSearch } from "../lib/pending-surface-search"
import { routeSurfaceBridge } from "../lib/route-surface-bridge"
import {
  RoutingMemoryBudgetExceeded,
  PendingRoutingWorkBudgetExceeded,
} from "../lib/routing-memory-budget"
import type { Connection, SimpleRouteJson, Terminal } from "../lib/types"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

function finish<T>(search: Generator<void, T>) {
  let yields = 0
  let result = search.next()
  while (!result.done) {
    yields++
    result = search.next()
  }
  return { value: result.value, yields }
}

function plain() {
  const connection: Connection = {
    name: "DATA",
    width: 0.1,
    pointsToConnect: [
      { x: -0.5, y: 0, layer: "top" },
      { x: 0.5, y: 0, layer: "top" },
    ],
  }
  const terminals: Terminal[] = [
    { x: 0, y: 0.6, layer: "top", layers: ["top", "bottom"] },
    { x: 0.2, y: 0.6, layer: "top" },
  ]
  const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  const input: SimpleRouteJson = {
    layerCount: 2,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    bounds,
    connections: [connection],
    obstacles: [],
    traces: [],
    pendingRoutingAccess: [
      {
        minTraceWidth: 0.22,
        minTraceToPadEdgeClearance: 0.18,
        bounds,
        connections: [{ name: "LATER", pointsToConnect: terminals }],
      },
    ],
  }
  return { input, connection, terminals }
}

test("counterexample cuts snapshot both peer endpoints and preserve every future rule", () => {
  const { input, terminals } = plain()
  const original = structuredClone(input)
  const search = new PendingSurfaceSearch({
    input,
    maximumExpansions: 100,
    viaCounts: [0, 2, 4],
  })
  search.attachMemory(8192)
  expect(search.accountingInput().pendingRoutingAccess![0].connections).toEqual(
    [],
  )
  expect(search.activate(terminals)).toBe(true)
  expect(search.activate(terminals)).toBe(false)
  expect(search.activate([{ x: 100, y: 100, layer: "top" }])).toBe(false)
  expect(search.accountingInput()).toMatchObject(input)
  expect(input).toEqual(original)
  search.dispose()
})

test("diversity retains every count, unspent work and the original aggregate cap", () => {
  const { input } = plain()
  const search = new PendingSurfaceSearch({
    input,
    maximumExpansions: 100,
    viaCounts: [0, 2, 4],
  })
  const initial = search.initialPass()
  for (let index = 0; index < 10; index++) search.expand(initial)
  const counts: number[] = []
  const allowances: number[] = []
  for (const pass of search.passes(0)) {
    counts.push(pass.requiredVias!)
    allowances.push(pass.remaining)
    // A count that exhausts its physical frontier leaves its unused work.
    if (pass.requiredVias !== 0)
      for (let index = 0; index < 5; index++) search.expand(pass)
    else while (pass.remaining) search.expand(pass)
  }
  expect(counts).toEqual([2, 4, 0])
  expect(allowances).toEqual([30, 43, 80])
  expect(search.remaining).toBe(0)
  expect(() => search.noSolution()).toThrow(PendingRoutingWorkBudgetExceeded)
  search.dispose()
})

test("rejected physical memo excludes allocation IDs, retains feedback and stays inside memory", () => {
  const { input, connection, terminals } = plain()
  const search = new PendingSurfaceSearch({
    input,
    maximumExpansions: 100,
    viaCounts: [0, 2],
  })
  search.attachMemory(8192)
  const route = {
    carrier: {
      type: "pcb_trace" as const,
      pcb_trace_id: "first",
      connection_name: connection.name,
      route: connection.pointsToConnect.map((point) => ({
        ...point,
        route_type: "wire" as const,
        width: 0.1,
      })),
    },
    escapes: [],
  }
  const key = search.routeKey(route)
  expect(
    search.routeKey({
      ...route,
      carrier: { ...route.carrier, pcb_trace_id: "another" },
    }),
  ).toBe(key)
  search.reject(key, terminals)
  const witness = structuredClone(terminals)
  terminals[0].layers!.push("inner1")
  expect(search.rejection(key)).toEqual(witness)
  const used = search.memory!.usedBytes
  search.reject("x".repeat(8192), terminals)
  expect(search.memory!.usedBytes).toBe(used)
  expect(
    search.routeKey({
      ...route,
      carrier: { ...route.carrier, source_trace_id: "other_owner" },
    }),
  ).not.toBe(key)
  search.dispose()
  expect(search.memory!.usedBytes).toBe(0)
})

test("aggregate work exhaustion is unknown, never a cached absence", () => {
  const { input, connection, terminals } = plain()
  const original = structuredClone(input)
  const outcomes = new CandidateSearchOutcomes()
  const run = () =>
    finish(
      outcomes.run(
        routeSurfaceBridge(input, connection, {
          gridStep: 0.1,
          maxExpansions: 0,
          pendingAccessFeedback: () => terminals,
          acceptRoute: function* () {
            return false
          },
        }),
      ),
    ).value
  expect(run()).toBeNull()
  expect(outcomes.unknownCount).toBe(1)
  expect(run()).toBeNull()
  expect(outcomes.unknownCount).toBe(2)
  expect(() => outcomes.noSolution()).toThrow(PendingRoutingWorkBudgetExceeded)
  expect(input).toEqual(original)
})

test("cancellation closes a suspended physical predicate and leaks no accepted result", () => {
  const { input, connection, terminals } = plain()
  let active = 0
  const search = routeSurfaceBridge(input, connection, {
    gridStep: 0.1,
    maxExpansions: 50000,
    pendingAccessFeedback: () => terminals,
    acceptRoute: function* () {
      active++
      try {
        yield
        return false
      } finally {
        active--
      }
    },
  })
  let result = search.next()
  while (!result.done && !active) result = search.next()
  expect(active).toBe(1)
  expect(search.return(null)).toEqual({ done: true, value: null })
  expect(active).toBe(0)
  const after = search.next()
  expect(after.done).toBe(true)
  expect(after.value).toBeUndefined()
})

test("no-intent search ignores pending feedback and retains exact output and yields", () => {
  const { input, connection, terminals } = plain()
  delete input.pendingRoutingAccess
  const original = structuredClone(input)
  const legacy = finish(
    routeSurfaceBridge(input, connection, { gridStep: 0.1 }),
  )
  const feedback = finish(
    routeSurfaceBridge(input, connection, {
      gridStep: 0.1,
      pendingAccessFeedback: () => terminals,
    }),
  )
  expect(feedback).toEqual(legacy)
  expect(input).toEqual(original)
})

test("a zero-via pending-safe route stays eligible with every manufactured count available", () => {
  const { input, connection, terminals } = plain()
  let calls = 0
  const answer = finish(
    routeSurfaceBridge(input, connection, {
      gridStep: 0.1,
      maxVias: 4,
      pendingAccessFeedback: () => terminals,
      acceptRoute: function* () {
        calls++
        return true
      },
    }),
  ).value
  expect(answer).not.toBeNull()
  expect(calls).toBe(1)
  expect(
    joinSignalEscapes(answer!.carrier, answer!.escapes).route.filter(
      (point) => point.route_type === "via",
    ),
  ).toEqual([])
})

test("finite-width pocket candidates still pass the original combined-copper oracle", () => {
  const { input, upperLeft, lowerRight } = pendingPadAccessFixture()
  const current: Connection = {
    name: lowerRight.connection_name!,
    width: 0.1,
    pointsToConnect: [
      lowerRight.route[0],
      lowerRight.route.at(-1)!,
    ] as Terminal[],
  }
  input.traces = [upperLeft]
  input.connections = [current]
  const original = structuredClone(input)
  const access = new PendingPadAccess(input)
  let rejected: Terminal[] = []
  const result = finish(
    routeSurfaceBridge(input, current, {
      gridStep: 0.1,
      maxExpansions: 150000,
      pendingAccessFeedback: () => rejected,
      acceptRoute: function* (route) {
        const blocked = yield* access.getBlockedObligations([
          joinSignalEscapes(route.carrier, route.escapes),
        ])
        rejected = blocked.flatMap((obligation) =>
          obligation.kind === "terminal"
            ? [obligation.connection.pointsToConnect[obligation.terminalIndex]]
            : [
                obligation.connection.pointsToConnect[
                  obligation.link.sourceTerminalIndex
                ],
                obligation.connection.pointsToConnect[
                  obligation.link.targetTerminalIndex
                ],
              ],
        )
        return !blocked.length
      },
    }),
  ).value
  expect(result).not.toBeNull()
  expect(
    finish(
      new PendingPadAccess(input).getBlockedObligations([
        joinSignalEscapes(result!.carrier, result!.escapes),
      ]),
    ).value,
  ).toEqual([])
  expect(input).toEqual(original)
})

test("cut bookkeeping is charged and failed growth publishes no partial cut", () => {
  const { input, terminals } = plain()
  const empty = new PendingSurfaceSearch({
    input,
    maximumExpansions: 100,
    viaCounts: [0, 2],
  })
  expect(() => empty.attachMemory(0)).toThrow(RoutingMemoryBudgetExceeded)
  expect(empty.memory).toBeUndefined()
  const tight = new PendingSurfaceSearch({
    input,
    maximumExpansions: 100,
    viaCounts: [0, 2],
  })
  tight.attachMemory(2048)
  const before = tight.memory!.usedBytes
  expect(() => tight.activate(terminals)).toThrow(RoutingMemoryBudgetExceeded)
  expect(tight.accountingInput().pendingRoutingAccess![0].connections).toEqual(
    [],
  )
  expect(tight.memory!.usedBytes).toBe(before)
  expect(tight.activate([terminals[1]])).toBe(true)
  expect(tight.memory!.usedBytes).toBeGreaterThan(before)
  tight.releasePassMemory()
  expect(tight.memory!.usedBytes).toBeGreaterThan(before)
  tight.dispose()
  expect(tight.memory!.usedBytes).toBe(0)
})
