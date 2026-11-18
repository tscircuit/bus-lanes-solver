import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("blocking one surface exit retains access through another without a via", () => {
  const { input, leftWall, upperLeft, lowerRight } = pendingPadAccessFixture()
  const bottomCopper = input.obstacles.find((obstacle) =>
    obstacle.layers.includes("bottom"),
  )!
  bottomCopper.width = 12
  bottomCopper.height = 12
  const access = new PendingPadAccess(input)
  expect(blockedPendingConnections(access, [leftWall])).toEqual([])
  expect(
    blockedPendingConnections(access, [upperLeft, lowerRight]).map(
      (connection) => connection.name,
    ),
  ).toEqual(["DDR_STROBE"])
  expect(blockedPendingConnections(access, [leftWall])).toEqual([])
})
