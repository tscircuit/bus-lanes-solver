import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("in-place route edits invalidate the cached access result", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  const candidate = [upperLeft, lowerRight]
  const access = new PendingPadAccess(input)

  // Shortening these two arms leaves a surface escape through either corner.
  lowerRight.route[0].y = 0
  lowerRight.route[2].x = 0
  expect(blockedPendingConnections(access, candidate)).toEqual([])

  // Keep the trace, route array, and points themselves. Matching and
  // compaction can update the same objects after a successful access check.
  lowerRight.route[0].y = 0.54
  lowerRight.route[2].x = -0.54
  expect(
    blockedPendingConnections(access, candidate).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])

  lowerRight.route[0].y = 0
  lowerRight.route[2].x = 0
  expect(blockedPendingConnections(access, candidate)).toEqual([])
})
