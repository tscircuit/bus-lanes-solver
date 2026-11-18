import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import type { Connection, Trace } from "../lib/types"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

type AccessSearch = Generator<void, Connection[]>

function fixture() {
  const value = pendingPadAccessFixture()
  // Require real planar escape searches rather than an early via witness.
  const bottom = value.input.obstacles.find((obstacle) =>
    obstacle.layers.includes("bottom"),
  )!
  bottom.width = 12
  bottom.height = 12
  return value
}

function renamed(traces: readonly Trace[], suffix: string): Trace[] {
  return structuredClone(traces).map((trace) => ({
    ...trace,
    pcb_trace_id: `${trace.pcb_trace_id}_${suffix}`,
  }))
}

function finish(search: AccessSearch): Connection[] {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

function names(connections: Connection[]): string[] {
  return connections.map((connection) => connection.name).sort()
}

function finishInterleaved(searches: AccessSearch[]): Connection[][] {
  const answers: Array<Connection[] | undefined> = searches.map(() => undefined)
  while (answers.some((answer) => answer === undefined))
    for (const [index, search] of searches.entries()) {
      if (answers[index] !== undefined) continue
      const state = search.next()
      if (state.done) answers[index] = state.value
    }
  return answers as Connection[][]
}

test("interleaved physical access checks agree with independent sequential scenes", () => {
  const { input, upperLeft, lowerRight } = fixture()
  const candidates = [[upperLeft, lowerRight], [lowerRight]]
  const original = structuredClone({ input, candidates })
  const reference = candidates.map((candidate) =>
    names(blockedPendingConnections(new PendingPadAccess(input), candidate)),
  )
  expect(reference).toEqual([["DDR_STROBE"], []])

  const access = new PendingPadAccess(input)
  expect(blockedPendingConnections(access, [])).toEqual([])
  const searches = candidates.map((candidate) =>
    access.getUncertifiedConnections(candidate),
  )
  // Both scenes remain live together; the second check must not replace the
  // first scene's copper or borrow its active flood-search parent buffers.
  for (const search of searches) expect(search.next().done).toBe(false)
  expect(finishInterleaved(searches).map(names)).toEqual(reference)
  expect({ input, candidates }).toEqual(original)
})

test("cancelling one live check permits reuse while another check remains active", () => {
  const { input, upperLeft, lowerRight } = fixture()
  const blocked = [upperLeft, lowerRight]
  const clear = [lowerRight]
  const replacement = renamed(blocked, "after_cancel")
  const original = structuredClone({ input, blocked, clear, replacement })
  const reference = [clear, replacement].map((candidate) =>
    names(blockedPendingConnections(new PendingPadAccess(input), candidate)),
  )
  const access = new PendingPadAccess(input)
  expect(blockedPendingConnections(access, [])).toEqual([])
  const cancelled = access.getUncertifiedConnections(blocked)
  const survivor = access.getUncertifiedConnections(clear)
  expect(cancelled.next().done).toBe(false)
  expect(survivor.next().done).toBe(false)
  expect(cancelled.return([]).done).toBe(true)

  const reused = access.getUncertifiedConnections(replacement)
  expect(reused.next().done).toBe(false)
  expect(finishInterleaved([survivor, reused]).map(names)).toEqual(reference)
  expect({ input, blocked, clear, replacement }).toEqual(original)
})

test("a suspended check snapshots candidate copper before caller mutation and request reuse", () => {
  const { input, upperLeft, lowerRight } = fixture()
  const candidate = renamed([upperLeft, lowerRight], "mutable")
  const originalInput = structuredClone(input)
  const capturedCandidate = structuredClone(candidate)
  const referenceCaptured = names(
    blockedPendingConnections(new PendingPadAccess(input), capturedCandidate),
  )
  expect(referenceCaptured).toEqual(["DDR_STROBE"])
  const access = new PendingPadAccess(input)
  expect(blockedPendingConnections(access, [])).toEqual([])
  const suspended = access.getUncertifiedConnections(candidate)
  expect(suspended.next().done).toBe(false)

  // Keep the original trace, route array and vertex objects. A caller may
  // shorten copper during matching while this cooperative check is paused.
  candidate[1]!.route[0]!.y = 0
  candidate[1]!.route[2]!.x = 0
  const editedCandidate = structuredClone(candidate)
  expect(finish(suspended).map((connection) => connection.name)).toEqual(
    referenceCaptured,
  )
  expect(
    names(blockedPendingConnections(new PendingPadAccess(input), candidate)),
  ).toEqual([])
  expect(blockedPendingConnections(access, candidate)).toEqual([])

  // A distinct ID prevents an exact result-memo hit. Its original geometry
  // exercises the old physical-grid content key after A -> edited B -> A.
  const originalGeometryAgain = renamed(capturedCandidate, "again")
  const originalAgain = structuredClone(originalGeometryAgain)
  expect(
    names(blockedPendingConnections(access, originalGeometryAgain)),
  ).toEqual(referenceCaptured)
  expect(input).toEqual(originalInput)
  expect(candidate).toEqual(editedCandidate)
  expect(originalGeometryAgain).toEqual(originalAgain)
})
