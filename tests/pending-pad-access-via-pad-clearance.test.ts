import { expect, test } from "bun:test"
import {
  pendingPadEscapeIsClear,
  type PendingPadEscape,
} from "../lib/pending-pad-escape"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

test("a future via witness must satisfy its via-edge to pad-edge clearance", () => {
  const { input, pendingConnection } = pendingPadAccessFixture()
  input.obstacles = input.obstacles.filter(
    (obstacle) => !obstacle.layers.includes("bottom"),
  )
  input.obstacles.push({
    type: "rect",
    center: { x: 1, y: 0 },
    width: 0.2,
    height: 0.2,
    layers: ["bottom"],
    connectedTo: ["FOREIGN_PAD"],
  })
  input.pendingRoutingAccess![0].minViaEdgeToPadEdgeClearance = 0.3
  const future = { ...input, ...input.pendingRoutingAccess![0] }
  const escape: PendingPadEscape = {
    path: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ],
    layer: "top",
    via: { point: { x: 0.5, y: 0 }, layers: ["top", "bottom"] },
  }
  const request = {
    input: future,
    connection: pendingConnection,
    terminalIndex: 0,
  }

  // The via edge is 0.2 mm from the foreign pad edge. The dogbone itself
  // stays on top and clears all copper under the ordinary 0.1 mm trace rule.
  expect(
    pendingPadEscapeIsClear(
      {
        ...request,
        input: { ...future, minViaEdgeToPadEdgeClearance: 0.1 },
      },
      escape,
    ),
  ).toBe(true)
  expect(pendingPadEscapeIsClear(request, escape)).toBe(false)
})

test("via-in-pad permission does not depend on a package identifier", () => {
  const { input, pendingConnection } = pendingPadAccessFixture()
  input.obstacles = input.obstacles.filter(
    (obstacle) => !obstacle.layers.includes("bottom"),
  )
  const ownedPad = input.obstacles.find((obstacle) =>
    obstacle.connectedTo.includes("cpu_strobe"),
  )!
  delete ownedPad.componentId
  const escape: PendingPadEscape = {
    path: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    layer: "top",
    via: { point: { x: 0, y: 0 }, layers: ["top", "bottom"] },
  }
  const request = { input, connection: pendingConnection, terminalIndex: 0 }

  expect(
    pendingPadEscapeIsClear(
      {
        ...request,
        input: { ...input, allowViaInPad: true },
      },
      escape,
    ),
  ).toBe(true)
  expect(pendingPadEscapeIsClear(request, escape)).toBe(false)
})
