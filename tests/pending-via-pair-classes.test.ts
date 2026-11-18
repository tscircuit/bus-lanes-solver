import { expect, test } from "bun:test"
import { PendingPadScene } from "../lib/pending-pad-escape"
import type { Obstacle, SimpleRouteJson, Trace } from "../lib/types"
import { validatePendingTerminalWitness } from "./fixtures/pending-access-certificates"

function fixture(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    allowViaInPad: false,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    obstacles: [],
    traces: [],
    connections: [
      {
        name: "FUTURE",
        width: 0.1,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
  }
}

function scene(input: SimpleRouteJson): PendingPadScene {
  return new PendingPadScene({
    input,
    connection: input.connections[0],
    terminalIndex: 0,
  })
}

function nonPlatedHole(): Obstacle {
  return {
    type: "rect",
    shape: "circle",
    isNonPlatedHole: true,
    center: { x: 2, y: 0.3 },
    width: 0.2,
    height: 0.2,
    layers: ["top", "bottom"],
    connectedTo: [],
  }
}

function oldVia(): Trace {
  return {
    type: "pcb_trace",
    pcb_trace_id: "old-via",
    connection_name: "OTHER",
    route: [
      {
        route_type: "via",
        x: 2,
        y: 0.5,
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "bottom"],
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
    ],
  }
}

test("marked non-plated holes use their own wire clearance independently of pad clearance", () => {
  const input = fixture()
  input.obstacles = [nonPlatedHole()]
  input.minTraceToHoleEdgeClearance = 0.2
  const original = structuredClone(input)
  const path = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
  ]
  // Physical copper-to-hole gap is 0.15mm: between the two declared rules.
  expect(scene(input).scene.pathVisible(path)).toBe(false)
  expect(
    scene({
      ...input,
      minTraceToHoleEdgeClearance: 0.1,
      minTraceToPadEdgeClearance: 0.3,
    }).scene.pathVisible(path),
  ).toBe(true)
  expect(
    scene({
      ...input,
      obstacles: input.obstacles.map((hole) => ({
        ...hole,
        isNonPlatedHole: false,
      })),
    }).scene.pathVisible(path),
  ).toBe(true)
  expect(
    scene({
      ...input,
      minTraceToHoleEdgeClearance: 0,
      minTraceToPadEdgeClearance: 0.9,
    }).scene.pathVisible(path),
  ).toBe(true)
  expect(
    scene({
      ...input,
      minTraceToHoleEdgeClearance: 0,
      obstacles: input.obstacles.map((hole) => ({
        ...hole,
        center: { x: 2, y: 0 },
      })),
    }).scene.pathVisible(path),
  ).toBe(false)
  expect(input).toEqual(original)
})

test("a non-plated-hole wire rule does not inflate existing via drills or new via exclusions", () => {
  const input = fixture()
  input.minTraceToHoleEdgeClearance = 2
  input.traces = [
    oldVia(),
    {
      type: "pcb_trace",
      pcb_trace_id: "old-wire",
      connection_name: "OTHER",
      route: [
        { route_type: "wire", x: 1, y: 0.5, layer: "top", width: 0.1 },
        { route_type: "wire", x: 3, y: 0.5, layer: "top", width: 0.1 },
      ],
    },
  ]
  const original = structuredClone(input)
  expect(
    scene(input).scene.pathVisible([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]),
  ).toBe(true)
  expect(scene(input).viaSpan({ x: 2, y: 0 }, "bottom")).toEqual([
    "top",
    "bottom",
  ])
  expect(input).toEqual(original)
})

test("via-in-pad policy distinguishes drill intrusion from same-net annulus overlap and tangency", () => {
  const input = fixture()
  input.obstacles = [
    {
      type: "rect",
      componentId: "CPU",
      center: { x: 0, y: 0 },
      width: 0.3,
      height: 0.3,
      layers: ["top"],
      connectedTo: ["FUTURE"],
    },
  ]
  const original = structuredClone(input)
  expect(scene(input).viaSpan({ x: 0.3, y: 0 }, "bottom")).toEqual([
    "top",
    "bottom",
  ])
  expect(scene(input).viaSpan({ x: 0.25, y: 0 }, "bottom")).toEqual([
    "top",
    "bottom",
  ])
  expect(scene(input).viaSpan({ x: 0.24, y: 0 }, "bottom")).toBeUndefined()
  expect(
    scene({ ...input, allowViaInPad: true }).viaSpan(
      { x: 0.24, y: 0 },
      "bottom",
    ),
  ).toEqual(["top", "bottom"])
  expect(input).toEqual(original)
})

test("allowing via-in-pad never permits a foreign-net annulus short", () => {
  const input = fixture()
  input.minViaEdgeToPadEdgeClearance = 0
  input.obstacles = [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.3,
      height: 0.3,
      layers: ["top"],
      connectedTo: ["OTHER"],
    },
  ]
  const original = structuredClone(input)
  for (const allowViaInPad of [false, true]) {
    const view = { ...input, allowViaInPad }
    expect(scene(view).viaSpan({ x: 0.3, y: 0 }, "bottom")).toBeUndefined()
    expect(scene(view).viaSpan({ x: 0.36, y: 0 }, "bottom")).toEqual([
      "top",
      "bottom",
    ])
  }
  expect(input).toEqual(original)
})

test("two via drills retain their declared pair rule instead of acquiring a plated-hole rule", () => {
  const input = fixture()
  input.traces = [oldVia()]
  input.minViaHoleEdgeToViaHoleEdgeClearance = 0.1
  input.minPlatedHoleDrillEdgeToDrillEdgeClearance = 0.9
  const original = structuredClone(input)
  // Drill-edge gap is 0.3mm; both objects are declared vias, not plated holes.
  expect(scene(input).viaSpan({ x: 2, y: 0 }, "bottom")).toEqual([
    "top",
    "bottom",
  ])
  expect(
    scene({ ...input, minViaHoleEdgeToViaHoleEdgeClearance: 0.31 }).viaSpan(
      { x: 2, y: 0 },
      "bottom",
    ),
  ).toBeUndefined()
  expect(input).toEqual(original)
})

test("the independent certificate retains the marked non-plated-hole wire rule", () => {
  const input = fixture()
  input.minTraceToHoleEdgeClearance = 0.2
  input.obstacles = [
    nonPlatedHole(),
    ...[0, 4].map(
      (x, index): Obstacle => ({
        type: "rect",
        componentId: "PACKAGE_" + index,
        center: { x, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["FUTURE"],
      }),
    ),
  ]
  input.pendingRoutingAccess = [
    {
      connections: input.connections,
      bounds: input.bounds,
      minTraceWidth: input.minTraceWidth,
      minTraceToPadEdgeClearance: input.minTraceToPadEdgeClearance,
      minTraceToHoleEdgeClearance: input.minTraceToHoleEdgeClearance,
      minViaEdgeToPadEdgeClearance: 0,
    },
  ]
  const original = structuredClone(input)
  const request = {
    input,
    traces: [],
    phaseIndex: 0,
    connection: input.connections[0],
    terminalIndex: 0,
    witness: {
      path: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      layer: "top",
    },
  }
  expect(validatePendingTerminalWitness(request).valid).toBe(false)
  const allowed = {
    ...input,
    pendingRoutingAccess: input.pendingRoutingAccess.map((phase) => ({
      ...phase,
      minTraceToHoleEdgeClearance: 0.1,
    })),
  }
  expect(
    validatePendingTerminalWitness({ ...request, input: allowed }).valid,
  ).toBe(true)
  expect(input).toEqual(original)
})
