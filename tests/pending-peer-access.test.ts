import { expect, test } from "bun:test"
import {
  applyToPoint,
  compose,
  rotateDEG,
  translate,
} from "transformation-matrix"
import { PendingPadAccess } from "../lib/pending-pad-access"
import {
  PendingPeerAccess,
  PendingPeerAccessUnknownError,
} from "../lib/pending-peer-access"
import type { Connection, SimpleRouteJson, Trace } from "../lib/types"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

function finish<Result>(search: Generator<void, Result>): Result {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

function peerFixture(): { input: SimpleRouteJson; connection: Connection } {
  const connection: Connection = {
    name: "FUTURE_NET",
    width: 0.1,
    pointsToConnect: [
      { x: -1, y: 0, layer: "top", pointId: "source" },
      { x: 1, y: 0, layer: "top", pointId: "target" },
    ],
  }
  return {
    connection,
    input: {
      layerCount: 2,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      allowedLayers: ["top"],
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      minViaPadDiameter: 0.4,
      minViaHoleDiameter: 0.2,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      allowViaInPad: false,
      allowBlindAndBuriedVias: false,
      connections: [connection],
      obstacles: [],
      traces: [],
    },
  }
}

function wall({
  layer = "top",
  x = 0,
  horizontal = false,
  id = "wall",
}: {
  layer?: string
  x?: number
  horizontal?: boolean
  id?: string
} = {}): Trace {
  return {
    type: "pcb_trace",
    pcb_trace_id: id,
    connection_name: id,
    route: (horizontal
      ? [
          { x: -2.95, y: x },
          { x: 2.95, y: x },
        ]
      : [
          { x, y: -2.95 },
          { x, y: 2.95 },
        ]
    ).map((point) => ({ ...point, route_type: "wire", layer, width: 0.1 })),
  }
}

function ring(radiusMm = 0.8): Trace {
  return {
    type: "pcb_trace",
    pcb_trace_id: "closed_ring",
    connection_name: "OTHER_NET",
    route: [
      { x: -radiusMm, y: -radiusMm },
      { x: radiusMm, y: -radiusMm },
      { x: radiusMm, y: radiusMm },
      { x: -radiusMm, y: radiusMm },
      { x: -radiusMm, y: -radiusMm },
    ].map((point) => ({
      ...point,
      route_type: "wire",
      layer: "top",
      width: 0.1,
    })),
  }
}

function ownedVia(
  connection: Connection,
  { x, id }: { x: number; id: string },
): Trace {
  return {
    type: "pcb_trace",
    pcb_trace_id: id,
    connection_name: connection.name,
    route: [
      {
        route_type: "via",
        x,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
    ],
  }
}

function integratedAccess(input: SimpleRouteJson): PendingPadAccess {
  input.pendingRoutingAccess = [
    {
      connections: input.connections,
      bounds: input.bounds,
      allowedLayers: input.allowedLayers,
      minTraceWidth: input.minTraceWidth,
      minTraceToPadEdgeClearance: input.minTraceToPadEdgeClearance,
      minViaPadDiameter: input.minViaPadDiameter,
      minViaHoleDiameter: input.minViaHoleDiameter,
      minViaHoleEdgeToViaHoleEdgeClearance:
        input.minViaHoleEdgeToViaHoleEdgeClearance,
      allowViaInPad: input.allowViaInPad,
      allowBlindAndBuriedVias: input.allowBlindAndBuriedVias,
    },
  ]
  return new PendingPadAccess(input)
}

test("an unframed future terminal must retain an actual peer, beyond one-width motion", () => {
  const { input, connection } = peerFixture()
  connection.pointsToConnect[0].x = 0
  connection.pointsToConnect[1].x = 2
  const access = new PendingPeerAccess(input, connection)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(access.getUncertifiedConnections({ ...input, traces: [ring()] })),
  ).toBe(true)
})

test("an unlabelled large owned pad cannot supply a false local escape", () => {
  const { input, connection } = peerFixture()
  connection.pointsToConnect[0].x = 0
  connection.pointsToConnect[1].x = 2
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1.2,
    height: 1.2,
    layers: ["top"],
    connectedTo: [connection.name],
  })
  const access = new PendingPeerAccess(input, connection)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(access.getUncertifiedConnections({ ...input, traces: [ring(1)] })),
  ).toBe(true)
})

test("all peers may legitimately stay inside one closed island without any board exit", () => {
  const { input, connection } = peerFixture()
  connection.pointsToConnect[0].x = -0.2
  connection.pointsToConnect[1].x = 0.2
  const access = new PendingPeerAccess(input, connection)
  expect(
    finish(access.getUncertifiedConnections({ ...input, traces: [ring()] })),
  ).toBe(false)
})

test("four peers split into two reachable pairs still lose their baseline component", () => {
  const { input, connection } = peerFixture()
  connection.pointsToConnect = [-1.5, -0.8, 0.8, 1.5].map((x) => ({
    x,
    y: 0,
    layer: "top",
  }))
  const access = new PendingPeerAccess(input, connection)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(access.getUncertifiedConnections({ ...input, traces: [wall()] })),
  ).toBe(true)
})

test("already separated peers do not hide a newly divided baseline component", () => {
  const { input, connection } = peerFixture()
  connection.pointsToConnect = [
    { x: -1.5, y: -1, layer: "top" },
    { x: -1.5, y: 1, layer: "top" },
    { x: 1.5, y: 0, layer: "top" },
  ]
  input.traces = [wall()]
  const access = new PendingPeerAccess(input, connection)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [...input.traces, wall({ horizontal: true, id: "new_wall" })],
      }),
    ),
  ).toBe(true)
})

test("unframed collective trapping is checked against the full candidate union", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  input.obstacles = input.obstacles.map(
    ({ componentId, ...obstacle }) => obstacle,
  )
  const access = new PendingPeerAccess(input, pendingConnection)
  expect(
    finish(access.getUncertifiedConnections({ ...input, traces: [upperLeft] })),
  ).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({ ...input, traces: [lowerRight] }),
    ),
  ).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [upperLeft, lowerRight],
      }),
    ),
  ).toBe(true)
})

test("peer connectivity uses the future bus width through a real clearance bottleneck", () => {
  const { input, connection } = peerFixture()
  input.obstacles = [-1.65, 1.65].map((y) => ({
    type: "rect",
    center: { x: 0, y },
    width: 0.2,
    height: 2.6,
    layers: ["top"],
    connectedTo: ["GND"],
  }))
  const narrowing: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "narrowing",
    connection_name: "GND",
    route: [-0.4, 0.4].map((x) => ({
      x,
      y: 0.2,
      layer: "top",
      route_type: "wire",
      width: 0.1,
    })),
  }
  const narrow = new PendingPeerAccess(input, connection)
  expect(
    finish(narrow.getUncertifiedConnections({ ...input, traces: [narrowing] })),
  ).toBe(false)
  input.buses = [
    {
      busId: "future_bus",
      connectionNames: [connection.name],
      traceWidth: 0.4,
    },
  ]
  const wide = new PendingPeerAccess(input, connection)
  expect(finish(wide.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(wide.getUncertifiedConnections({ ...input, traces: [narrowing] })),
  ).toBe(true)
})

test("a legal via must continue to the opposite-layer peer rather than end in a pocket", () => {
  const { input, connection } = peerFixture()
  input.allowedLayers = ["top", "bottom"]
  connection.pointsToConnect[1].layer = "bottom"
  const topWall = wall({ layer: "top", id: "top_wall" })
  const bottomWall = wall({ layer: "bottom", id: "bottom_wall" })
  const access = new PendingPeerAccess(input, connection)
  expect(
    finish(access.getUncertifiedConnections({ ...input, traces: [topWall] })),
  ).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({ ...input, traces: [bottomWall] }),
    ),
  ).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [topWall, bottomWall],
      }),
    ),
  ).toBe(true)
})

test("an existing owned via remains conductive when a new coincident via cannot be made", () => {
  const { input, connection } = peerFixture()
  input.allowedLayers = ["top", "bottom"]
  input.minViaPadDiameter = 6
  connection.pointsToConnect[1].layer = "bottom"
  input.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "supplied_via",
      source_trace_id: connection.source_trace_id,
      connection_name: connection.name,
      route: [
        {
          route_type: "via",
          x: -0.8,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
      ],
    },
  ]
  const supplied = JSON.stringify(input.traces)
  const access = new PendingPeerAccess(input, connection)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [...input.traces, wall({ layer: "bottom" })],
      }),
    ),
  ).toBe(true)
  expect(JSON.stringify(input.traces)).toBe(supplied)
})

test("declared native terminal layers provide physical continuity without a new via", () => {
  const { input, connection } = peerFixture()
  input.allowedLayers = ["bottom"]
  input.minViaPadDiameter = 6
  connection.pointsToConnect[0].layers = ["top", "bottom"]
  connection.pointsToConnect[1].layer = "bottom"
  const access = new PendingPeerAccess(input, connection)
  expect(
    finish(access.getUncertifiedConnections({ ...input, traces: [wall()] })),
  ).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [wall({ layer: "bottom" })],
      }),
    ),
  ).toBe(true)
})

test("cached access cannot keep a candidate-owned via that was removed from the union", () => {
  const { input, connection } = peerFixture()
  input.allowedLayers = ["top", "bottom"]
  input.minViaPadDiameter = 8
  connection.pointsToConnect[1].layer = "bottom"
  const leftVia = ownedVia(connection, { x: -0.8, id: "left_via" })
  const rightVia = ownedVia(connection, { x: 0.8, id: "right_via" })
  const bottomWall = wall({ layer: "bottom" })
  input.traces = [leftVia]
  const access = new PendingPeerAccess(input, connection)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [leftVia, bottomWall, rightVia],
      }),
    ),
  ).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [leftVia, bottomWall],
      }),
    ),
  ).toBe(true)
})

test("cached off-carrier conductivity must still exist with its actual extent and width", () => {
  const { input, connection } = peerFixture()
  input.minViaPadDiameter = 8
  const leftVia = ownedVia(connection, { x: -0.8, id: "left_via" })
  const rightVia = ownedVia(connection, { x: 0.8, id: "right_via" })
  const bridge: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "owned_bridge",
    connection_name: connection.name,
    route: [-0.8, 0.8].map((x) => ({
      x,
      y: 0,
      layer: "bottom",
      route_type: "wire",
      width: 0.1,
    })),
  }
  input.traces = [leftVia, rightVia]
  const topWall = wall()
  const access = new PendingPeerAccess(input, connection)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [leftVia, rightVia, topWall, bridge],
      }),
    ),
  ).toBe(false)
  // Retain the same object and ID while changing its physical connectivity.
  bridge.route[1].x = -0.4
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [leftVia, rightVia, topWall, bridge],
      }),
    ),
  ).toBe(true)
})

test("unframed peer trapping is invariant under board-space rotation and translation", () => {
  for (const ccwRotationDegrees of [45, 90, 180]) {
    const { input, connection } = peerFixture()
    connection.pointsToConnect[0].x = 0
    connection.pointsToConnect[1].x = 2
    const localToBoard = compose(
      translate(0.2, -0.3),
      rotateDEG(ccwRotationDegrees),
    )
    connection.pointsToConnect = connection.pointsToConnect.map((terminal) => ({
      ...terminal,
      ...applyToPoint(localToBoard, terminal),
    }))
    const closed = ring()
    closed.route = closed.route.map((point) => ({
      ...point,
      ...applyToPoint(localToBoard, point),
    }))
    const access = new PendingPeerAccess(input, connection)
    expect(
      finish(access.getUncertifiedConnections({ ...input, traces: [closed] })),
    ).toBe(true)
  }
})

test("the pending-access wrapper protects an unlabelled pad using real peer connectivity", () => {
  const { input, connection } = peerFixture()
  connection.pointsToConnect[0].x = 0
  connection.pointsToConnect[1].x = 2
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1.2,
    height: 1.2,
    layers: ["top"],
    connectedTo: [connection.name],
  })
  const access = integratedAccess(input)
  expect(finish(access.getUncertifiedConnections([]))).toEqual([])
  expect(
    finish(access.getUncertifiedConnections([ring(1)])).map(
      (peer) => peer.name,
    ),
  ).toEqual([connection.name])
})

test("the pending-access wrapper preserves the whole multi-peer component", () => {
  const { input, connection } = peerFixture()
  connection.pointsToConnect = [-1.5, -0.8, 0.8, 1.5].map((x) => ({
    x,
    y: 0,
    layer: "top",
  }))
  const access = integratedAccess(input)
  expect(
    finish(access.getUncertifiedConnections([wall()])).map((peer) => peer.name),
  ).toEqual([connection.name])
})

test("grid exhaustion propagates instead of becoming disconnected or accepted", () => {
  const { input, connection } = peerFixture()
  input.bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100 }
  input.minTraceWidth = 0.01
  const access = new PendingPeerAccess(input, connection)
  expect(() => finish(access.getUncertifiedConnections(input))).toThrow(
    PendingPeerAccessUnknownError,
  )
  const wrapper = integratedAccess(input)
  expect(() => finish(wrapper.getUncertifiedConnections([wall()]))).toThrow(
    PendingPeerAccessUnknownError,
  )
})
