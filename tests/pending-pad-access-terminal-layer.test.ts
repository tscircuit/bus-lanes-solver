import { expect, test } from "bun:test"
import { applyToPoint, translate } from "transformation-matrix"
import { PendingPadAccess } from "../lib/pending-pad-access"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("a later terminal on the opposite layer retains access on its own layer", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  const peer = pendingConnection.pointsToConnect[1]
  peer.layer = "bottom"
  for (const obstacle of input.obstacles) {
    if (obstacle.componentId === "RAM") obstacle.layers = ["bottom"]
  }
  input.obstacles.push({
    type: "rect",
    center: { x: peer.x, y: peer.y },
    width: 2.6,
    height: 2.6,
    layers: ["top"],
    connectedTo: ["GND"],
  })
  const toPeer = translate(peer.x, peer.y)
  const newCopper = [upperLeft, lowerRight].map((trace, index) => ({
    ...trace,
    pcb_trace_id: `bottom_ram_data_${index}`,
    connection_name: `BOTTOM_RAM_DATA_${index}`,
    route: trace.route.map((point) => ({
      ...point,
      ...applyToPoint(toPeer, point),
      layer: "bottom",
    })),
  }))
  const access = new PendingPadAccess(input)

  expect(blockedPendingConnections(access, [])).toEqual([])
  expect(blockedPendingConnections(access, [newCopper[0]])).toEqual([])
  expect(blockedPendingConnections(access, [newCopper[1]])).toEqual([])
  expect(
    blockedPendingConnections(access, newCopper).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
})

test("a multilayer terminal keeps access while either native layer can escape", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  pendingConnection.pointsToConnect[0].layers = ["top", "bottom"]
  input.obstacles = input.obstacles.filter(
    (obstacle) => !obstacle.layers.includes("bottom"),
  )
  for (const obstacle of input.obstacles) {
    if (obstacle.componentId === "CPU") obstacle.layers = ["top", "bottom"]
  }
  // This barrel cannot fit inside the closed ring. Access must come from an
  // available native layer rather than a transition through the trapped one.
  input.minViaPadDiameter = 1.2
  input.pendingRoutingAccess![0].minViaPadDiameter = 1.2
  const bottomCopper = [upperLeft, lowerRight].map((trace, index) => ({
    ...trace,
    pcb_trace_id: `bottom_cpu_data_${index}`,
    connection_name: `BOTTOM_CPU_DATA_${index}`,
    route: trace.route.map((point) => ({ ...point, layer: "bottom" })),
  }))
  const access = new PendingPadAccess(input)

  expect(blockedPendingConnections(access, [upperLeft, lowerRight])).toEqual([])
  expect(
    blockedPendingConnections(access, [
      upperLeft,
      lowerRight,
      ...bottomCopper,
    ]).map((connection) => connection.name),
  ).toEqual([pendingConnection.name])
})
