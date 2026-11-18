import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"
import { pendingIndependentClosuresFixture } from "./fixtures/pending-independent-closures"

function finish<Result>(search: Generator<void, Result>): Result {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

function sameNetFixture() {
  const value = pendingIndependentClosuresFixture()
  const connection = {
    name: "ONE_LATER_NET",
    width: 0.1,
    pointsToConnect: value.closures.map(
      (closure) => closure.connection.pointsToConnect[0],
    ),
  }
  value.input.pendingRoutingAccess = [
    {
      ...value.input.pendingRoutingAccess![0],
      connections: [connection],
    },
  ]
  return { ...value, connection }
}

test("independent terminal obligations keep stable identity while connection results stay deduplicated", () => {
  const { input, previous, closures, connection } = sameNetFixture()
  const original = structuredClone(previous)
  const access = new PendingPadAccess(input)
  const all = finish(access.getBlockedObligations(previous.traces))
  expect(all).toHaveLength(2)
  expect(
    all.every(
      (obligation) =>
        obligation.kind === "terminal" && obligation.connection === connection,
    ),
  ).toBe(true)
  expect(
    new Set(
      all.map((obligation) =>
        obligation.kind === "terminal" ? obligation.terminalIndex : -1,
      ),
    ),
  ).toEqual(new Set([0, 1]))
  expect(finish(access.getUncertifiedConnections(previous.traces))).toEqual([
    connection,
  ])

  const prefix = [...closures[1].traces, closures[0].traces[0]]
  const existing = finish(access.getBlockedObligations(prefix))
  expect(existing).toHaveLength(1)
  expect(existing[0]).toBe(all[1])
  const differentKey = structuredClone(previous.traces).map((trace) => ({
    ...trace,
    pcb_trace_id: trace.pcb_trace_id + "_another_union",
  }))
  const newlyBlocked = finish(
    access.getBlockedObligations(differentKey, {
      excludedObligations: new Set(existing),
    }),
  )
  expect(newlyBlocked).toEqual([all[0]])
  // A filtered result cannot replace complete result evidence for this key.
  expect(finish(access.getBlockedObligations(differentKey))).toEqual(all)
  expect(
    finish(access.getBlockedObligations(differentKey, { obligation: all[1] })),
  ).toEqual([all[1]])
  expect(() =>
    finish(
      access.getBlockedObligations(differentKey, {
        obligation: { ...all[0] },
      }),
    ),
  ).toThrow("declared physical obligations")
  expect(previous).toEqual(original)
})

test("peer-link obligations expose stable original links through the same physical query API", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  input.obstacles = input.obstacles.map(
    ({ componentId, ...obstacle }) => obstacle,
  )
  const access = new PendingPadAccess(input)
  const candidate = [upperLeft, lowerRight]
  const blocked = finish(access.getBlockedObligations(candidate))
  expect(blocked).toHaveLength(1)
  const obligation = blocked[0]
  expect(obligation.kind).toBe("peer")
  expect(obligation.connection).toBe(pendingConnection)
  if (obligation.kind !== "peer") return
  expect(obligation.link).toEqual({
    sourceTerminalIndex: 0,
    targetTerminalIndex: 1,
  })
  expect(
    finish(access.getBlockedObligations(candidate, { obligation }))[0],
  ).toBe(obligation)
  expect(finish(access.getUncertifiedConnections(candidate))).toEqual([
    pendingConnection,
  ])
  expect(
    finish(
      access.getBlockedObligations(candidate, {
        excludedObligations: new Set([obligation]),
        stopAfterFirst: true,
      }),
    ),
  ).toEqual([])
  expect(finish(access.getBlockedObligations(candidate))).toEqual(blocked)
})
