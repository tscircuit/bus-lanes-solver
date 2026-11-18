import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
  rotatePendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("pending terminal access is invariant under package and board rotation", () => {
  for (const ccwRotationDegrees of [45, 90]) {
    const { input, pendingConnection, upperLeft, lowerRight } =
      rotatePendingPadAccessFixture(
        pendingPadAccessFixture(),
        ccwRotationDegrees,
      )
    const access = new PendingPadAccess(input)
    expect(blockedPendingConnections(access, [upperLeft])).toEqual([])
    expect(blockedPendingConnections(access, [lowerRight])).toEqual([])
    expect(
      blockedPendingConnections(access, [upperLeft, lowerRight]).map(
        (connection) => connection.name,
      ),
    ).toEqual([pendingConnection.name])
  }
})
