import { expect, test } from "bun:test"
import { applyToPoint, translate } from "transformation-matrix"
import { PendingPadAccess } from "../lib/pending-pad-access"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("an inaccessible supplied terminal does not excuse trapping its accessible peer", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  input.traces = [upperLeft, lowerRight]
  const peer = pendingConnection.pointsToConnect[1]
  input.obstacles.push({
    type: "rect",
    center: { x: peer.x, y: peer.y },
    width: 2.6,
    height: 2.6,
    layers: ["bottom"],
    connectedTo: ["GND"],
  })
  const toPeer = translate(peer.x, peer.y)
  const newCopper = [upperLeft, lowerRight].map((trace, index) => ({
    ...trace,
    pcb_trace_id: `ram_data_${index}`,
    connection_name: `RAM_DATA_${index}`,
    route: trace.route.map((point) => ({
      ...point,
      ...applyToPoint(toPeer, point),
    })),
  }))
  const original = structuredClone(input)
  const access = new PendingPadAccess(input)
  expect(blockedPendingConnections(access, [])).toEqual([])
  expect(
    blockedPendingConnections(access, newCopper).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
  expect(input).toEqual(original)
})
