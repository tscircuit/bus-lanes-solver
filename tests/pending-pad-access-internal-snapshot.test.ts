import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"
import { pendingInternalPeersFixture } from "./fixtures/pending-internal-peers"

test("internal baseline activation snapshots candidate copper before its first yield", () => {
  const { input, pendingConnection, addedCopper } = pendingInternalPeersFixture(
    {
      interiorWallHalfLength: 0.5,
    },
  )
  const originalInput = structuredClone(input)
  const captured = structuredClone(addedCopper)
  const expected = blockedPendingConnections(
    new PendingPadAccess(input),
    captured,
  ).map((connection) => connection.name)
  expect(expected).toEqual([pendingConnection.name])

  const access = new PendingPadAccess(input)
  const suspended = access.getUncertifiedConnections(addedCopper)
  // No warm-up: this first yield belongs to the original internal-carrier
  // baseline activation, which must not postpone the candidate snapshot.
  expect(suspended.next().done).toBe(false)
  const wall = addedCopper.find(
    (trace) => trace.pcb_trace_id === "internal_foreign_wall",
  )!
  wall.route[0].y = -0.2
  wall.route[1].y = 0.2
  const edited = structuredClone(addedCopper)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), edited),
  ).toEqual([])
  let result = suspended.next()
  while (!result.done) result = suspended.next()
  expect(result.value.map((connection) => connection.name)).toEqual(expected)
  expect(blockedPendingConnections(access, edited)).toEqual([])
  expect(
    blockedPendingConnections(access, captured).map(
      (connection) => connection.name,
    ),
  ).toEqual(expected)
  expect(input).toEqual(originalInput)
  expect(addedCopper).toEqual(edited)
}, 15_000)
