import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib/types"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

function checkOwnedAccess(layeredChain: boolean): void {
  const { input, pendingConnection } = pendingPadAccessFixture()
  input.obstacles = input.obstacles.filter(
    (pad) => pad.componentId !== undefined,
  )
  for (const pad of input.obstacles) {
    if (pad.componentId === "RAM") pad.layers = ["bottom"]
  }
  input.connections = [
    {
      name: "FOREIGN_FENCE",
      width: 0.1,
      pointsToConnect: [
        { x: -0.6, y: -0.45, layer: "top" },
        { x: -0.6, y: -0.6, layer: "top" },
      ],
    },
  ]
  pendingConnection.pointsToConnect[1]!.layer = "bottom"
  input.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "existing_strobe_via",
      connection_name: pendingConnection.name,
      route: [
        {
          route_type: "via",
          x: 1,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          layers: ["top", "bottom"],
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
      ],
    },
  ]
  if (layeredChain) {
    input.layerCount = 4
    input.traces[0].route = [
      {
        route_type: "via",
        x: 1,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
        layers: ["top", "inner1"],
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner1" },
      { route_type: "wire", x: 1.5, y: 0, width: 0.1, layer: "inner1" },
      {
        route_type: "via",
        x: 1.5,
        y: 0,
        from_layer: "inner1",
        to_layer: "bottom",
        layers: ["inner1", "bottom"],
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
    ]
  }
  const intent = input.pendingRoutingAccess![0]!
  intent.allowedLayers = ["bottom"]
  // No new land of this diameter fits the board. The already manufactured
  // owned via remains valid copper from the earlier phase, with its own size.
  intent.minViaPadDiameter = 20
  intent.minViaHoleDiameter = 0.2
  const future: SimpleRouteJson = {
    ...intent,
    layerCount: input.layerCount,
    obstacles: input.obstacles,
    traces: input.traces,
  }
  const before = structuredClone(input)
  // Independently demonstrate the baseline path: a top wire reaches the
  // supplied via, whose bottom span can reach the RAM terminal.
  const baselinePaths = [
    [
      "top",
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    ],
    [
      "bottom",
      [
        { x: layeredChain ? 1.5 : 1, y: 0 },
        { x: 3, y: 3 },
      ],
    ],
    ...(layeredChain
      ? [
          [
            "inner1",
            [
              { x: 1, y: 0 },
              { x: 1.5, y: 0 },
            ],
          ],
        ]
      : []),
  ] as Array<[string, [{ x: number; y: number }, { x: number; y: number }]]>
  for (const [layer, path] of baselinePaths) {
    const connection = {
      ...pendingConnection,
      pointsToConnect: pendingConnection.pointsToConnect.map((point) => ({
        ...point,
        layer,
      })),
    }
    const scene = new VectorScene(future, connection, 0.1, fixedCopper(future))
    expect(scene.visible(path[0], path[1])).toBe(true)
  }
  // A current route can preserve all present copper while closing the future
  // terminal's exit. Its two endpoints are distinct; the remaining 0.05 mm
  // copper gap cannot admit the future 0.1 mm trace and its clearances.
  const enclosure: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "foreign_native_layer_enclosure",
    connection_name: "FOREIGN_FENCE",
    route: [
      { route_type: "wire", x: -0.6, y: -0.45, width: 0.1, layer: "top" },
      { route_type: "wire", x: -0.6, y: 0.6, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.6, y: 0.6, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.6, y: -0.6, width: 0.1, layer: "top" },
      { route_type: "wire", x: -0.6, y: -0.6, width: 0.1, layer: "top" },
    ],
  }
  const fenceScene = new VectorScene(
    input,
    {
      name: "FOREIGN_FENCE",
      pointsToConnect: input.connections[0]!.pointsToConnect,
    },
    0.1,
    fixedCopper(input),
  )
  expect(fenceScene.pathVisible(enclosure.route)).toBe(true)
  const blocked = blockedPendingConnections(new PendingPadAccess(input), [
    enclosure,
  ]).map((connection) => connection.name)
  expect(blocked).toEqual([pendingConnection.name])
  expect(input).toEqual(before)
}

test("a framed pending terminal retains access through its supplied owned via", () => {
  checkOwnedAccess(false)
}, 15_000)

test("a framed pending terminal retains access through a supplied via-wire-via chain", () => {
  checkOwnedAccess(true)
}, 15_000)

test("an already connected pair still needs access to the remaining framed peer", () => {
  const { input, pendingConnection } = pendingPadAccessFixture()
  const pairedPad = input.obstacles.find((pad) =>
    pad.connectedTo.includes("unused_cpu_0_2"),
  )!
  pairedPad.center.y = 1
  pairedPad.connectedTo = [pendingConnection.name, "cpu_paired_terminal"]
  pendingConnection.pointsToConnect.push({
    x: 0,
    y: 1,
    layer: "top",
    pcb_port_id: "cpu_paired_terminal",
  })
  // Other CPU pads retain the package field at y = +/-2. Both paired pads
  // and the enclosure stay inside it, so neither reaches a package exit.
  const shield = input.obstacles.find((pad) => pad.layers.includes("bottom"))!
  shield.width = 6
  shield.height = 6
  input.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "already_connected_cpu_pair",
      connection_name: pendingConnection.name,
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.1 },
      ],
    },
  ]
  const enclosure: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "foreign_pair_enclosure",
    connection_name: "FOREIGN_FENCE",
    route: [
      { route_type: "wire", x: -0.7, y: -1.55, layer: "top", width: 0.1 },
      { route_type: "wire", x: -0.7, y: 1.7, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0.7, y: 1.7, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0.7, y: -1.7, layer: "top", width: 0.1 },
      { route_type: "wire", x: -0.7, y: -1.7, layer: "top", width: 0.1 },
    ],
  }
  input.connections = [
    {
      name: "FOREIGN_FENCE",
      width: 0.1,
      pointsToConnect: [
        { x: -0.7, y: -1.55, layer: "top" },
        { x: -0.7, y: -1.7, layer: "top" },
      ],
    },
  ]
  const original = structuredClone(input)
  const future = {
    ...input.pendingRoutingAccess![0],
    layerCount: input.layerCount,
    obstacles: input.obstacles,
    traces: input.traces,
  }
  const futureScene = new VectorScene(
    future,
    pendingConnection,
    0.1,
    fixedCopper(future),
  )
  for (const y of [0, 1])
    expect(
      futureScene.pathVisible([
        { x: 0, y },
        { x: -1, y },
        { x: -1, y: 4.5 },
      ]),
    ).toBe(true)
  const fenceScene = new VectorScene(
    input,
    input.connections[0],
    0.1,
    fixedCopper(input),
  )
  expect(fenceScene.pathVisible(enclosure.route)).toBe(true)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), [enclosure]).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
  expect(input).toEqual(original)
}, 15_000)
