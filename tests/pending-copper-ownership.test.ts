import { expect, test } from "bun:test"
import { PendingCopperOwnership } from "../lib/pending-copper-ownership"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingPadGeometry } from "../lib/pending-pad-geometry"
import { PendingPadScene } from "../lib/pending-pad-escape"
import type { Connection, Obstacle, SimpleRouteJson, Trace } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"

const connection = (name: string): Connection => ({
  name,
  pointsToConnect: [
    { x: 0, y: 0, layer: "top", pcb_port_id: name + "-start" },
    { x: 4, y: 0, layer: "top", pcb_port_id: name + "-end" },
  ],
})
function inputFor(connections: Connection[]): SimpleRouteJson {
  return {
    connections,
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
  }
}
function pad(owners: string[]): Obstacle {
  return {
    type: "rect",
    componentId: "SAME_PACKAGE",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    connectedTo: owners,
  }
}

test("declared electrical aliases are transitive and independent of record order", () => {
  const current = connection("native"),
    later = connection("later")
  current.source_trace_id = "arbitrary-current-id"
  const input = inputFor([current])
  input.pendingRoutingAccess = [{ ...input, connections: [later] }]
  input.obstacles = [
    pad(["arbitrary-current-id", "bridge-a"]),
    pad(["bridge-c", "later"]),
    pad(["bridge-b", "bridge-c"]),
    pad(["bridge-a", "bridge-b"]),
  ]
  const original = structuredClone(input)
  for (const obstacles of [
    input.obstacles,
    [...input.obstacles].reverse().map((value) => ({
      ...value,
      connectedTo: [...value.connectedTo].reverse(),
    })),
  ]) {
    const owners = new PendingCopperOwnership({ ...input, obstacles }).owners(
      later,
    )
    for (const alias of [
      "native",
      "arbitrary-current-id",
      "bridge-a",
      "bridge-b",
      "bridge-c",
      "later",
    ])
      expect(owners.has(alias)).toBe(true)
    expect(owners.has("SAME_PACKAGE")).toBe(false)
  }
  expect(input).toEqual(original)
})

test("shared native ports and explicit net roots survive private future-phase views without obstacles", () => {
  const current = connection("current"),
    middle = connection("middle"),
    later = connection("later")
  middle.pointsToConnect[0].pcb_port_id = current.pointsToConnect[0].pcb_port_id
  later.pointsToConnect[0] = {
    ...middle.pointsToConnect[1],
    pcb_port_id: "later-start",
    pointId: middle.pointsToConnect[1].pcb_port_id,
  }
  later.pointsToConnect[1].x = 5
  const input = inputFor([current])
  input.pendingRoutingAccess = [
    { ...input, connections: [middle] },
    { ...input, connections: [later] },
  ]
  expect(
    new PendingPadAccess(input).getConnectionOwners(later).has("current"),
  ).toBe(true)
  current.netConnectionName = "electrical-root"
  later.rootConnectionName = "electrical-root"
  middle.pointsToConnect = connection("independent").pointsToConnect
  expect(new PendingCopperOwnership(input).owners(later).has("current")).toBe(
    true,
  )
})

test("geometry, component identity and non-electrical metadata never join owner classes", () => {
  const current = connection("current"),
    later = connection("later")
  const input = inputFor([current, later])
  const sharedMetadata = { component: "shared", package: "generic" }
  const samePackage = ["current", "later"].map((owner) => ({
    ...pad([owner]),
    circuitJsonMetadata: sharedMetadata,
  }))
  input.obstacles = samePackage
  const owners = new PendingCopperOwnership(input).owners(later)
  expect(owners.has("current")).toBe(false)
  expect(owners.has("SAME_PACKAGE")).toBe(false)
  expect(owners.has("shared")).toBe(false)
})

test("owned selection does not manufacture continuity between disconnected same-net pieces", () => {
  const current = connection("current"),
    later = connection("later")
  const input = inputFor([current])
  input.pendingRoutingAccess = [
    { ...input, connections: [later], allowedLayers: ["top"] },
  ]
  input.obstacles = [pad(["current", "later"])]
  const segment: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "old-piece",
    connection_name: "current",
    route: [
      { x: 3, y: 0, route_type: "wire", layer: "top", width: 0.1 },
      { x: 4, y: 0, route_type: "wire", layer: "top", width: 0.1 },
    ],
  }
  input.traces = [segment]
  const future = {
    ...input.pendingRoutingAccess[0],
    layerCount: input.layerCount,
    obstacles: input.obstacles,
    traces: input.traces,
  }
  const geometry = new PendingPadGeometry(
    future,
    new PendingCopperOwnership(input),
  )
  const owned = geometry.ownedCarrierAccess(later)
  expect(owned.wires).toHaveLength(1)
  expect(
    owned.connectedContacts({
      from: { point: later.pointsToConnect[0], layer: "top" },
      to: { point: segment.route[1], layer: "top" },
    }),
  ).toBe(false)
  expect(
    new PendingPadScene(
      { input: future, connection: later, terminalIndex: 0 },
      geometry,
    ).existingEgress(),
  ).toBeUndefined()
})

test("prepared owner sets are shared across many sections and their pending scenes", () => {
  const connections = Array.from({ length: 100 }, (_, index) => ({
    ...connection("section-" + index),
    rootConnectionName: "one-electrical-net",
  }))
  const input = inputFor(connections),
    identity = new PendingCopperOwnership(input)
  const canonical = identity.owners(connections[0])
  const geometry = new PendingPadGeometry(input, identity)
  for (const value of connections) {
    expect(identity.owners(value)).toBe(canonical)
    expect(
      identity.owners({
        ...value,
        pointsToConnect: value.pointsToConnect.map((point) => ({
          ...point,
          layer: "bottom",
        })),
      }),
    ).toBe(canonical)
    expect(
      geometry.createScene({ connection: value, width: 0.1, copper: [] })
        .owners,
    ).toBe(canonical)
  }
  const external = connection("external")
  external.rootConnectionName = "one-electrical-net"
  const extra = identity.owners(external)
  expect(extra).not.toBe(canonical)
  expect(extra.has("section-99")).toBe(true)
  expect(extra.has("external")).toBe(true)
  expect(canonical.has("external")).toBe(false)
})

test("fresh mutable declaration metadata gets a fresh identity and legacy scenes stay unchanged", () => {
  const current = connection("current"),
    later = connection("later")
  const input = inputFor([current, later])
  input.obstacles = [pad(["current", "later"])]
  const first = new PendingCopperOwnership(input)
  const before = first.owners(later)
  const copper = fixedCopper({
    ...input,
    obstacles: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "piece",
        connection_name: "current",
        route: [
          { x: 0, y: 0, route_type: "wire", layer: "top", width: 0.1 },
          { x: 1, y: 0, route_type: "wire", layer: "top", width: 0.1 },
        ],
      },
    ],
  })
  expect(new VectorScene(input, later, 0.1, copper).copper).toHaveLength(1)
  expect(
    VectorScene.withOwnership({
      input,
      connection: later,
      width: 0.1,
      copper,
      owners: before,
    }).copper,
  ).toHaveLength(0)
  input.obstacles[0].connectedTo.splice(0, 2, "unrelated")
  const fresh = new PendingCopperOwnership(input)
  expect(fresh.owners(later).has("current")).toBe(false)
  expect(before.has("current")).toBe(true)
  expect(() =>
    fresh.assertMatches({ ...input, obstacles: [...input.obstacles] }),
  ).toThrow("another obstacle")
})

test("explicit future net/root identity fields cannot be silently accepted with invalid types", () => {
  for (const field of ["netConnectionName", "rootConnectionName"] as const) {
    const later = connection("later"),
      input = inputFor([])
    input.pendingRoutingAccess = [{ ...input, connections: [later] }]
    Reflect.set(later, field, 123)
    expect(() => new PendingPadAccess(input)).toThrow(field)
  }
})
