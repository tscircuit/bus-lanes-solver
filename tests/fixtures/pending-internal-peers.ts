import type { SimpleRouteJson, Trace } from "../../lib/types"
import { pendingPadAccessFixture } from "./pending-pad-access"

/** Board-world mm, +X right and +Y up. Both future pads lie inside the
 * existing CPU pad field. A top copper enclosure removes field egress while
 * leaving the direct same-field connection clear. Bottom ground prevents a
 * manufactured through via from being an alternative exit.
 */
export function pendingInternalPeersFixture({
  enclosureHalfSize = 0.7,
  interiorWallHalfLength,
  futureWidth = 0.1,
  futureClearance = 0.1,
  futureAllowedLayers = ["top", "bottom"],
  layerCount = 2,
  allowBlindAndBuriedVias = false,
}: {
  enclosureHalfSize?: number
  interiorWallHalfLength?: number
  futureWidth?: number
  futureClearance?: number
  futureAllowedLayers?: string[]
  layerCount?: number
  allowBlindAndBuriedVias?: boolean
} = {}) {
  const fixture = pendingPadAccessFixture()
  const { input, pendingConnection } = fixture
  pendingConnection.width = futureWidth
  pendingConnection.pointsToConnect = [
    { x: -0.2, y: 0, layer: "top", pcb_port_id: "internal_left" },
    { x: 0.2, y: 0, layer: "top", pcb_port_id: "internal_right" },
  ]
  input.layerCount = layerCount
  input.obstacles = input.obstacles.filter((obstacle) =>
    obstacle.componentId !== "RAM" &&
    !(obstacle.componentId === "CPU" && obstacle.center.x === 0 && obstacle.center.y === 0),
  )
  for (const terminal of pendingConnection.pointsToConnect) {
    input.obstacles.push({
      type: "rect",
      componentId: "CPU",
      center: { x: terminal.x, y: terminal.y },
      width: 0.1,
      height: 0.1,
      layers: ["top"],
      connectedTo: [pendingConnection.name, terminal.pcb_port_id!],
    })
  }
  const group = input.pendingRoutingAccess![0]
  group.minTraceWidth = futureWidth
  group.minTraceToPadEdgeClearance = futureClearance
  group.allowedLayers = futureAllowedLayers
  group.allowBlindAndBuriedVias = allowBlindAndBuriedVias
  const edge = enclosureHalfSize
  const gap = 0.16
  const upperLeft: Trace = {
    ...fixture.upperLeft,
    route: [
      { x: -edge, y: -edge + gap, route_type: "wire", layer: "top", width: 0.1 },
      { x: -edge, y: edge, route_type: "wire", layer: "top", width: 0.1 },
      { x: edge - gap, y: edge, route_type: "wire", layer: "top", width: 0.1 },
    ],
  }
  const lowerRight: Trace = {
    ...fixture.lowerRight,
    route: [
      { x: edge, y: edge - gap, route_type: "wire", layer: "top", width: 0.1 },
      { x: edge, y: -edge, route_type: "wire", layer: "top", width: 0.1 },
      { x: -edge + gap, y: -edge, route_type: "wire", layer: "top", width: 0.1 },
    ],
  }
  const addedCopper = [upperLeft, lowerRight]
  if (interiorWallHalfLength !== undefined) {
    addedCopper.push({
      type: "pcb_trace",
      pcb_trace_id: "internal_foreign_wall",
      connection_name: "INTERNAL_WALL",
      route: [
        { x: 0, y: -interiorWallHalfLength, route_type: "wire", layer: "top", width: 0.1 },
        { x: 0, y: interiorWallHalfLength, route_type: "wire", layer: "top", width: 0.1 },
      ],
    })
  }
  return { input, pendingConnection, addedCopper }
}

export function withInternalPeerCopper({
  input,
  addedCopper,
}: {
  input: SimpleRouteJson
  addedCopper: Trace[]
}): SimpleRouteJson {
  return { ...input, traces: [...(input.traces ?? []), ...addedCopper] }
}

/** An explicit multilayer native terminal provides conductivity, but does not
 * make a wider future wire fit on a carrier plane. The current 0.02 mm wires
 * leave the actual 0.05 mm terminal copper clear at the current 0.1 mm rule.
 */
export function pendingFlexibleInternalPeersFixture(blockBottom: boolean) {
  const fixture = pendingInternalPeersFixture({
    futureWidth: 0.2,
    futureClearance: 0.05,
    futureAllowedLayers: ["bottom"],
  })
  const { input, pendingConnection, addedCopper } = fixture
  input.minTraceWidth = 0.02
  input.obstacles = input.obstacles.filter((obstacle) => !obstacle.connectedTo.includes("GND"))
  for (const obstacle of input.obstacles) {
    if (!obstacle.connectedTo.includes(pendingConnection.name)) continue
    obstacle.width = 0.05
    obstacle.height = 0.05
    obstacle.layers = ["top", "bottom"]
  }
  for (const terminal of pendingConnection.pointsToConnect) terminal.layers = ["top", "bottom"]
  // New barrels cannot fit on this board. Native multilayer access must stand
  // on its actual future-width clearance rather than another manufactured via.
  input.pendingRoutingAccess![0].minViaPadDiameter = 20
  if (blockBottom) {
    for (const [index, y] of [-0.15, 0.15].entries()) {
      addedCopper.push({
        type: "pcb_trace",
        pcb_trace_id: `bottom_corridor_${index}`,
        connection_name: `BOTTOM_CORRIDOR_${index}`,
        route: [
          { x: -1, y, route_type: "wire", layer: "bottom", width: 0.02 },
          { x: 1, y, route_type: "wire", layer: "bottom", width: 0.02 },
        ],
      })
    }
  }
  return fixture
}

/** A previously manufactured small via and bottom stub attach only one peer.
 * Visiting that dead end and returning on top does not create a bottom carrier
 * path between peers. Actual old dimensions remain unchanged.
 */
export function pendingInternalCarrierSpurFixture() {
  const fixture = pendingInternalPeersFixture({
    enclosureHalfSize: 1.2,
    futureWidth: 0.4,
    futureAllowedLayers: ["bottom"],
  })
  const { input, pendingConnection, addedCopper } = fixture
  input.minTraceWidth = 0.05
  input.obstacles = input.obstacles.filter((obstacle) => !obstacle.connectedTo.includes("GND"))
  input.pendingRoutingAccess![0].minViaPadDiameter = 20
  input.traces = [{
    type: "pcb_trace",
    pcb_trace_id: "supplied_internal_spur",
    connection_name: pendingConnection.name,
    route: [
      { x: -0.2, y: 0, route_type: "wire", layer: "top", width: 0.05 },
      { x: -0.6, y: 0, route_type: "wire", layer: "top", width: 0.05 },
      { x: -0.6, y: 0, route_type: "via", from_layer: "top", to_layer: "bottom", layers: ["top", "bottom"], via_diameter: 0.2, via_hole_diameter: 0.1 },
      { x: -0.6, y: 0, route_type: "wire", layer: "bottom", width: 0.05 },
      { x: -0.6, y: 0.05, route_type: "wire", layer: "bottom", width: 0.05 },
    ],
  }]
  for (const [index, y] of [-0.25, 0.25].entries()) {
    addedCopper.push({
      type: "pcb_trace",
      pcb_trace_id: `bottom_stub_pocket_${index}`,
      connection_name: `BOTTOM_STUB_POCKET_${index}`,
      route: [
        { x: -1, y, route_type: "wire", layer: "bottom", width: 0.1 },
        { x: 0, y, route_type: "wire", layer: "bottom", width: 0.1 },
      ],
    })
  }
  return fixture
}
