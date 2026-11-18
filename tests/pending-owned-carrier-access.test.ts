import { expect, test } from "bun:test"
import { PendingOwnedCarrierAccess } from "../lib/pending-owned-carrier-access"
import type { Point, SimpleRouteJson, Via } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"

function finish<T>(search: Generator<void, T>): T {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

function fixture(): SimpleRouteJson {
  return {
    layerCount: 4,
    bounds: { minX: -2, maxX: 8, minY: -2, maxY: 2 },
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    obstacles: [],
    connections: [
      {
        name: "STROBE",
        source_trace_id: "strobe_alias",
        width: 0.1,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 6, y: 0, layer: "bottom" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "first_existing_via",
        connection_name: "STROBE",
        route: [
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "inner1",
            layers: ["top", "inner1"],
            via_diameter: 0.4,
            via_hole_diameter: 0.2,
          },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "existing_inner_wire",
        source_trace_id: "strobe_alias",
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "inner1", width: 0.1 },
          { route_type: "wire", x: 4, y: 0, layer: "inner1", width: 0.1 },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "second_existing_via",
        connection_name: "STROBE",
        route: [
          {
            route_type: "via",
            x: 4,
            y: 0,
            from_layer: "inner1",
            to_layer: "bottom",
            layers: ["inner1", "bottom"],
            via_diameter: 0.4,
            via_hole_diameter: 0.2,
          },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "existing_bottom_wire",
        connection_name: "STROBE",
        route: [
          { route_type: "wire", x: 4, y: 0, layer: "bottom", width: 0.1 },
          { route_type: "wire", x: 6, y: 0, layer: "bottom", width: 0.1 },
        ],
      },
    ],
  }
}

function graph(input: SimpleRouteJson): PendingOwnedCarrierAccess {
  return new PendingOwnedCarrierAccess({
    input,
    connection: input.connections[0],
    ownedCopper: fixedCopper(input),
    ownedTraceCopper: fixedCopper({ ...input, obstacles: [] }),
    ownedVias: (input.traces ?? []).flatMap((trace) =>
      trace.route.filter((point): point is Via => point.route_type === "via"),
    ),
  })
}

function targets(access: PendingOwnedCarrierAccess) {
  return finish(
    access.prepareCarrierTargets({
      nativeLayer: "top",
      width: 0.1,
      carrierLayers: ["bottom"],
      carrierPoints: () => [],
      carrierPointIsClear: () => true,
      isCarrierExit: () => false,
    }),
  )
}

test("existing actual via spans and off-carrier wires form a transitive physical path", () => {
  const input = fixture()
  input.connections[0].width = 1
  const original = structuredClone(input)
  const access = graph(input)
  expect(access.viaSpans.map((via) => via.layers)).toEqual([
    ["top", "inner1"],
    ["inner1", "bottom"],
  ])
  expect(access.wires.map((wire) => wire.layer)).toEqual(["inner1", "bottom"])
  // Existing copper conducts at its actual width, even when the next phase
  // needs a wider newly manufactured route.
  expect(access.hasExistingCompleteConnection(0)).toBe(true)
  expect(access.hasExistingCompleteConnection(1)).toBe(true)
  expect(access.anchorComponents).toHaveLength(1)
  expect(
    access.connectedContacts({
      from: { point: { x: 0, y: 0 }, layer: "top" },
      to: { point: { x: 6, y: 0 }, layer: "bottom" },
    }),
  ).toBe(true)
  const target = targets(access).findCarrier({
    point: { x: 0, y: 0 },
    layer: "top",
    width: 0.1,
  })
  expect(target?.layer).toBe("bottom")
  expect(
    access.connectedToCarrier({
      point: { x: 0, y: 0 },
      layer: "top",
      width: 0.1,
      target: target!,
    }),
  ).toBe(true)
  expect(input).toEqual(original)
})

test("a fresh union cannot retain a removed, displaced or differently owned conductor", () => {
  const input = fixture()
  const target = targets(graph(input)).findCarrier({
    point: { x: 0, y: 0 },
    layer: "top",
    width: 0.1,
  })!
  const variants = [
    (changed: SimpleRouteJson) => {
      changed.traces!.splice(2, 1)
    },
    (changed: SimpleRouteJson) => {
      changed.traces![1].route[1].x = 3.6
    },
    (changed: SimpleRouteJson) => {
      changed.traces![1].source_trace_id = "DIFFERENT_NET"
    },
    (changed: SimpleRouteJson) => {
      const via = changed.traces![0].route[0] as Via
      via.to_layer = "inner2"
      via.layers = ["top", "inner2"]
    },
  ]
  for (const mutate of variants) {
    const changed = structuredClone(input)
    mutate(changed)
    const access = graph(changed)
    expect(access.hasExistingCompleteConnection(0)).toBe(false)
    expect(
      access.connectedContacts({
        from: { point: { x: 0, y: 0 }, layer: "top" },
        to: { point: { x: 6, y: 0 }, layer: "bottom" },
      }),
    ).toBe(false)
    expect(
      access.connectedToCarrier({
        point: { x: 0, y: 0 },
        layer: "top",
        width: 0.1,
        target,
      }),
    ).toBe(false)
  }
})

test("owned wires contact at segment interiors, independently of route vertices", () => {
  const input = fixture()
  input.connections[0].pointsToConnect[1].y = 1
  const via = input.traces![2].route[0] as Via
  via.x = 2
  via.y = 1
  input.traces![3].route[0].x = 2
  for (const point of input.traces![3].route) point.y = 1
  input.traces!.push({
    type: "pcb_trace",
    pcb_trace_id: "crossing_owned_branch",
    connection_name: "STROBE",
    route: [
      { route_type: "wire", x: 2, y: -1, layer: "inner1", width: 0.1 },
      { route_type: "wire", x: 2, y: 1, layer: "inner1", width: 0.1 },
    ],
  })
  expect(graph(input).hasExistingCompleteConnection(0)).toBe(true)
  const separated = structuredClone(input)
  separated.traces![4].route[0].y = 0.2
  expect(graph(separated).hasExistingCompleteConnection(0)).toBe(false)
})

test("nested rotated owned pads retain their continuous physical contact", () => {
  const input = fixture()
  input.traces![1].route[1].x = 1
  input.traces![1].route[1].y = -1
  input.traces!.push({
    type: "pcb_trace",
    pcb_trace_id: "other_side_of_rotated_pad",
    connection_name: "STROBE",
    route: [
      { route_type: "wire", x: 3, y: 1, layer: "inner1", width: 0.1 },
      { route_type: "wire", x: 4, y: 0, layer: "inner1", width: 0.1 },
    ],
  })
  input.obstacles = [
    {
      type: "rect",
      center: { x: 2, y: 0 },
      width: 3,
      height: 1,
      ccwRotationDegrees: 45,
      layers: ["inner1"],
      connectedTo: ["STROBE"],
    },
    {
      type: "rect",
      center: { x: 2, y: 0 },
      width: 0.3,
      height: 0.3,
      ccwRotationDegrees: 15,
      layers: ["inner1"],
      connectedTo: ["STROBE"],
    },
  ]
  expect(graph(input).hasExistingCompleteConnection(0)).toBe(true)
  input.obstacles.reverse()
  expect(graph(input).hasExistingCompleteConnection(0)).toBe(true)
  input.obstacles = input.obstacles.filter((pad) => pad.width < 1)
  expect(graph(input).hasExistingCompleteConnection(0)).toBe(false)
})

test("future-width carrier handoffs can occur inside a fixed wire, away from its endpoints", () => {
  const input = fixture()
  for (const x of [4, 6])
    input.obstacles.push({
      type: "rect",
      center: { x, y: 0.5 },
      width: 0.2,
      height: 0.2,
      layers: ["bottom"],
      connectedTo: ["FOREIGN_PAD"],
    })
  const connection = {
    ...input.connections[0],
    pointsToConnect: input.connections[0].pointsToConnect.map((terminal) => ({
      ...terminal,
      layer: "bottom",
    })),
  }
  const narrow = new VectorScene(input, connection, 0.1, fixedCopper(input))
  const wide = new VectorScene(input, connection, 0.8, fixedCopper(input))
  for (const x of [4, 6]) {
    expect(narrow.visible({ x, y: 0 }, { x, y: 0 })).toBe(true)
    expect(wide.visible({ x, y: 0 }, { x, y: 0 })).toBe(false)
  }
  const interior = { x: 5, y: 0 }
  expect(wide.visible(interior, interior)).toBe(true)
  const access = graph(input)
  const prepared = finish(
    access.prepareCarrierTargets({
      nativeLayer: "top",
      width: 0.8,
      carrierLayers: ["bottom"],
      carrierPoints: () => [interior],
      carrierPointIsClear: (point) => wide.visible(point, point),
      isCarrierExit: () => false,
    }),
  )
  expect(
    prepared.findCarrier({ point: { x: 0, y: 0 }, layer: "top", width: 0.8 }),
  ).toEqual({ point: interior, layer: "bottom" })
})

test("same-layer copper needs a package exit and independent views keep their own policy", () => {
  const access = graph(fixture())
  const prepare = (isCarrierExit: (point: Point) => boolean) =>
    finish(
      access.prepareCarrierTargets({
        nativeLayer: "top",
        width: 0.1,
        carrierLayers: ["top"],
        carrierPoints: () => [],
        carrierPointIsClear: () => true,
        isCarrierExit,
      }),
    )
  const closed = prepare(() => false)
  const open = prepare(() => true)
  const request = { point: { x: 0, y: 0 }, layer: "top", width: 0.1 }
  expect(closed.findCarrier(request)).toBeUndefined()
  const target = open.findCarrier(request)!
  expect(target.layer).toBe("top")
  target.point.x = 999
  expect(open.findCarrier(request)?.point.x).toBe(0)
  expect(closed.findCarrier(request)).toBeUndefined()
  expect(open.findCarrier({ ...request, layer: "inner2" })).toBeUndefined()
})

test("no owned trace avoids preparing or probing a carrier domain", () => {
  const input = fixture()
  for (const trace of input.traces!) {
    trace.connection_name = "OTHER_NET"
    trace.source_trace_id = undefined
  }
  const access = graph(input)
  expect(access.wires).toEqual([])
  expect(access.viaSpans).toEqual([])
  expect(access.anchors).toEqual([])
  expect(access.anchorComponents).toEqual([])
  expect(access.hasExistingCompleteConnection(0)).toBe(false)
  const unexpected = () => {
    throw Error("An empty owned graph must not inspect a carrier grid")
  }
  const search = access.prepareCarrierTargets({
    nativeLayer: "top",
    width: 0.1,
    carrierLayers: ["bottom"],
    carrierPoints: unexpected,
    carrierPointIsClear: unexpected,
    isCarrierExit: unexpected,
  })
  const result = search.next()
  expect(result.done).toBe(true)
  if (!result.done) throw Error("An empty owned graph yielded unexpectedly")
  expect(
    result.value.findCarrier({
      point: { x: 0, y: 0 },
      layer: "top",
      width: 0.1,
    }),
  ).toBeUndefined()
})
