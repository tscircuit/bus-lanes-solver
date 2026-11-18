import { expect, test } from "bun:test"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { fixedCopper } from "../lib/vector-scene"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("two mutually clear data routes can collectively close a later terminal's last escape", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  const original = structuredClone(input)
  const copper = [upperLeft, lowerRight].map((trace) =>
    fixedCopper({ ...input, obstacles: [], traces: [trace] }),
  )
  expect(
    new CopperConflictIndex().firstConflict(copper[0], copper[1], 0.1),
  ).toBeUndefined()

  const access = new PendingPadAccess(input)
  expect(blockedPendingConnections(access, [upperLeft])).toEqual([])
  expect(blockedPendingConnections(access, [lowerRight])).toEqual([])
  expect(
    blockedPendingConnections(access, [upperLeft, lowerRight]).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
  expect(blockedPendingConnections(access, [upperLeft])).toEqual([])
  expect(input).toEqual(original)
})
