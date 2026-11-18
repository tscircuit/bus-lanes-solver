import { applyToPoint, type Matrix, rotateDEG } from "transformation-matrix"
import type { PendingPadAccess } from "../../lib/pending-pad-access"
import type {
  Connection,
  Obstacle,
  Point,
  SimpleRouteJson,
  Trace,
} from "../../lib/types"

interface PendingPadAccessFixture {
  input: SimpleRouteJson
  pendingConnection: Connection
  upperLeft: Trace
  lowerRight: Trace
  leftWall: Trace
}

/** Board-world points in mm, +X right and +Y up. The two data routes keep
 * their mutual 0.1 mm clearance, but together close the narrower passage a
 * third 0.1 mm signal would need. Bottom copper prevents a via in that pocket.
 */
export function pendingPadAccessFixture(): PendingPadAccessFixture {
  const pendingConnection: Connection = {
    name: "DDR_STROBE",
    width: 0.1,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "cpu_strobe" },
      { x: 3, y: 3, layer: "top", pcb_port_id: "ram_strobe" },
    ],
  }
  const obstacles: Obstacle[] = []
  for (const x of [-2, 0, 2]) {
    for (const y of [-2, 0, 2]) {
      const isStrobe = x === 0 && y === 0
      obstacles.push({
        type: "rect",
        componentId: "CPU",
        center: { x, y },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: isStrobe
          ? [pendingConnection.name, "cpu_strobe"]
          : [`unused_cpu_${x}_${y}`],
      })
    }
  }
  for (const x of [1, 3, 5]) {
    for (const y of [1, 3, 5]) {
      const isStrobe = x === 3 && y === 3
      obstacles.push({
        type: "rect",
        componentId: "RAM",
        center: { x, y },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: isStrobe
          ? [pendingConnection.name, "ram_strobe"]
          : [`unused_ram_${x}_${y}`],
      })
    }
  }
  obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 2.6,
    height: 2.6,
    layers: ["bottom"],
    connectedTo: ["GND"],
  })
  const physicalRules = {
    layerCount: 2,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    allowViaInPad: false,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    outline: [
      { x: -6, y: -6 },
      { x: 6, y: -6 },
      { x: 6, y: 6 },
      { x: -6, y: 6 },
    ],
  }
  const pendingRoutingAccess = {
    ...physicalRules,
    connections: [pendingConnection],
  }
  const input: SimpleRouteJson = {
    ...physicalRules,
    connections: [],
    obstacles,
    traces: [],
    pendingRoutingAccess: [pendingRoutingAccess],
  }
  return {
    input,
    pendingConnection,
    upperLeft: {
      type: "pcb_trace",
      pcb_trace_id: "data_0",
      connection_name: "DATA_0",
      route: [
        { x: -0.7, y: -0.54, route_type: "wire", layer: "top", width: 0.1 },
        { x: -0.7, y: 0.7, route_type: "wire", layer: "top", width: 0.1 },
        { x: 0.54, y: 0.7, route_type: "wire", layer: "top", width: 0.1 },
      ],
    },
    lowerRight: {
      type: "pcb_trace",
      pcb_trace_id: "data_1",
      connection_name: "DATA_1",
      route: [
        { x: 0.7, y: 0.54, route_type: "wire", layer: "top", width: 0.1 },
        { x: 0.7, y: -0.7, route_type: "wire", layer: "top", width: 0.1 },
        { x: -0.54, y: -0.7, route_type: "wire", layer: "top", width: 0.1 },
      ],
    },
    leftWall: {
      type: "pcb_trace",
      pcb_trace_id: "data_wall",
      connection_name: "DATA_WALL",
      route: [
        { x: -0.7, y: -5.95, route_type: "wire", layer: "top", width: 0.1 },
        { x: -0.7, y: 5.95, route_type: "wire", layer: "top", width: 0.1 },
      ],
    },
  }
}

/** Rotate points and physical pad rectangles together, retaining the exact
 * board outline instead of replacing the rotated board with its larger AABB.
 */
export function rotatePendingPadAccessFixture(
  fixture: PendingPadAccessFixture,
  ccwRotationDegrees: number,
): PendingPadAccessFixture {
  const rotation = rotateDEG(ccwRotationDegrees)
  const outline = fixture.input.outline!.map((point) =>
    rotatePendingPoint(point, rotation),
  )
  const bounds = {
    minX: Math.min(...outline.map((point) => point.x)),
    maxX: Math.max(...outline.map((point) => point.x)),
    minY: Math.min(...outline.map((point) => point.y)),
    maxY: Math.max(...outline.map((point) => point.y)),
  }
  const pendingConnection = {
    ...fixture.pendingConnection,
    pointsToConnect: fixture.pendingConnection.pointsToConnect.map((point) =>
      rotatePendingPoint(point, rotation),
    ),
  }
  const input: SimpleRouteJson = {
    ...fixture.input,
    bounds,
    outline,
    obstacles: fixture.input.obstacles.map((obstacle) => ({
      ...obstacle,
      center: rotatePendingPoint(obstacle.center, rotation),
      ccwRotationDegrees:
        (obstacle.ccwRotationDegrees ?? 0) + ccwRotationDegrees,
    })),
    pendingRoutingAccess: fixture.input.pendingRoutingAccess!.map((group) => ({
      ...group,
      bounds,
      outline,
      connections: [pendingConnection],
    })),
  }
  const traces = [fixture.upperLeft, fixture.lowerRight, fixture.leftWall].map(
    (trace) => ({
      ...trace,
      route: trace.route.map((point) => rotatePendingPoint(point, rotation)),
    }),
  )
  return {
    input,
    pendingConnection,
    upperLeft: traces[0],
    lowerRight: traces[1],
    leftWall: traces[2],
  }
}

function rotatePendingPoint<T extends Point>(point: T, rotation: Matrix): T {
  return {
    ...point,
    ...applyToPoint(rotation, point),
  }
}

export function blockedPendingConnections(
  access: PendingPadAccess,
  traces: readonly Trace[],
): Connection[] {
  const check = access.getUncertifiedConnections(traces)
  let step = check.next()
  while (!step.done) step = check.next()
  return step.value
}

/** Keep unrelated-bus controls valid routing intent, using two otherwise
 * unused native pads whose access is independent of the central strobe. */
export function addUnrelatedFutureConnection(input: SimpleRouteJson): Connection {
  const pads = ["unused_cpu_-2_-2", "unused_ram_5_5"].map((id) =>
    input.obstacles.find((pad) => pad.connectedTo.includes(id))!,
  )
  const connection: Connection = {
    name: "OTHER_NET",
    pointsToConnect: pads.map((pad) => ({
      ...pad.center, layer: pad.layers[0], pcb_port_id: pad.connectedTo[0],
    })),
  }
  for (const pad of pads) pad.connectedTo.push(connection.name)
  input.pendingRoutingAccess![0].connections.push(connection)
  return connection
}
