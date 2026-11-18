import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import type { SimpleRouteJson, Trace } from "../lib/types"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("omitted future rules retain future defaults across a JSON roundtrip", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  input.minTraceToPadEdgeClearance = 0.2
  input.allowedLayers = ["bottom"]
  const future = input.pendingRoutingAccess![0]
  future.minTraceToPadEdgeClearance = undefined
  future.allowedLayers = undefined

  // These gaps admit the future default 0.075 mm clearance, but would close
  // if its physical scene inherited the current phase's 0.2 mm requirement.
  upperLeft.route[0].y = -0.35
  upperLeft.route[2].x = 0.35
  lowerRight.route[0].y = 0.35
  lowerRight.route[2].x = -0.35
  const copper: Trace[] = [upperLeft, lowerRight]
  for (const [index, y] of [-5, -3, -1, 1, 3, 5].entries()) {
    copper.push({
      type: "pcb_trace",
      pcb_trace_id: `bottom_shield_${index}`,
      connection_name: "GND",
      route: [
        { route_type: "wire", x: -5.05, y, width: 1.9, layer: "bottom" },
        { route_type: "wire", x: 5.05, y, width: 1.9, layer: "bottom" },
      ],
    })
  }
  for (const x of [-5.05, 5.05]) {
    copper.push({
      type: "pcb_trace",
      pcb_trace_id: `bottom_shield_rail_${x}`,
      connection_name: "GND",
      route: [
        { route_type: "wire", x, y: -5, width: 1.9, layer: "bottom" },
        { route_type: "wire", x, y: 5, width: 1.9, layer: "bottom" },
      ],
    })
  }

  const serialized: SimpleRouteJson = JSON.parse(JSON.stringify(input))
  expect(Object.hasOwn(future, "allowedLayers")).toBe(true)
  expect(
    Object.hasOwn(serialized.pendingRoutingAccess![0], "allowedLayers"),
  ).toBe(false)
  expect(
    Object.hasOwn(
      serialized.pendingRoutingAccess![0],
      "minTraceToPadEdgeClearance",
    ),
  ).toBe(false)
  const before = blockedPendingConnections(new PendingPadAccess(input), copper)
  const after = blockedPendingConnections(
    new PendingPadAccess(serialized),
    copper,
  )
  expect(before).toEqual([])
  expect(after).toEqual(before)

  const explicitDefaults = structuredClone(serialized)
  explicitDefaults.pendingRoutingAccess![0].allowedLayers = ["top", "bottom"]
  explicitDefaults.pendingRoutingAccess![0].minTraceToPadEdgeClearance = 0.075
  expect(
    blockedPendingConnections(new PendingPadAccess(explicitDefaults), copper),
  ).toEqual(after)

  const inheritedClearance = structuredClone(explicitDefaults)
  inheritedClearance.pendingRoutingAccess![0].minTraceToPadEdgeClearance = 0.2
  expect(
    blockedPendingConnections(
      new PendingPadAccess(inheritedClearance),
      copper,
    ).map((connection) => connection.name),
  ).toEqual([pendingConnection.name])
  const inheritedLayer = structuredClone(explicitDefaults)
  inheritedLayer.pendingRoutingAccess![0].allowedLayers = ["bottom"]
  expect(
    blockedPendingConnections(new PendingPadAccess(inheritedLayer), copper).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
})
