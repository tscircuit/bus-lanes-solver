import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import type { Trace } from "../lib/types"
import {
  blockedPendingConnections,
  addUnrelatedFutureConnection,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("the owning future bus width determines whether its terminal can leave", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  upperLeft.route[0].y = -0.35
  upperLeft.route[2].x = 0.35
  lowerRight.route[0].y = 0.35
  lowerRight.route[2].x = -0.35
  const copper = [upperLeft, lowerRight]
  const wide = structuredClone(input)
  wide.pendingRoutingAccess![0].buses = [
    {
      busId: "future-strobe",
      connectionNames: [pendingConnection.name],
      traceWidth: 0.3,
    },
  ]
  const unrelated = structuredClone(wide)
  addUnrelatedFutureConnection(unrelated)
  unrelated.pendingRoutingAccess![0].buses![0].connectionNames = ["OTHER_NET"]

  expect(
    blockedPendingConnections(new PendingPadAccess(input), copper),
  ).toEqual([])
  expect(
    blockedPendingConnections(new PendingPadAccess(wide), copper).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
  expect(
    blockedPendingConnections(new PendingPadAccess(unrelated), copper),
  ).toEqual([])
})

test("a future bus carrier restriction requires a legal transition from a native pad", () => {
  const { input, pendingConnection } = pendingPadAccessFixture()
  // Bottom stripes leave 0.1 mm between their copper edges. Joined end rails
  // also close the rounded-cap gaps at the board boundary. No 0.4 mm via land
  // fits in this layer, while top-layer escape paths remain untouched.
  const shielding: Trace[] = [-5, -3, -1, 1, 3, 5].map((y, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `bottom_shield_${index}`,
    connection_name: "GND",
    route: [
      { route_type: "wire", x: -5.05, y, width: 1.9, layer: "bottom" },
      { route_type: "wire", x: 5.05, y, width: 1.9, layer: "bottom" },
    ],
  }))
  const openEnds = [...shielding]
  for (const x of [-5.05, 5.05]) {
    shielding.push({
      type: "pcb_trace",
      pcb_trace_id: `bottom_shield_rail_${x}`,
      connection_name: "GND",
      route: [
        { route_type: "wire", x, y: -5, width: 1.9, layer: "bottom" },
        { route_type: "wire", x, y: 5, width: 1.9, layer: "bottom" },
      ],
    })
  }
  const restricted = structuredClone(input)
  restricted.pendingRoutingAccess![0].buses = [
    {
      busId: "future-strobe",
      connectionNames: [pendingConnection.name],
      allowedLayers: ["bottom"],
    },
  ]
  const unrelated = structuredClone(restricted)
  const otherConnection = addUnrelatedFutureConnection(unrelated)
  unrelated.pendingRoutingAccess![0].buses![0].connectionNames = ["OTHER_NET"]

  expect(
    blockedPendingConnections(new PendingPadAccess(input), shielding),
  ).toEqual([])
  const access = new PendingPadAccess(restricted)
  // Before joining the rounded ends, a distant legal via still fits near the
  // board edge. Restricting search to the package would lose that escape.
  expect(blockedPendingConnections(access, openEnds)).toEqual([])
  expect(
    blockedPendingConnections(access, shielding).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
  expect(
    blockedPendingConnections(new PendingPadAccess(unrelated), shielding).map(
      (connection) => connection.name,
    ),
  ).toEqual([otherConnection.name])
})
