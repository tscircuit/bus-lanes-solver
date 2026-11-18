import { expect, test } from "bun:test"
import { PendingPadGeometry } from "../lib/pending-pad-geometry"
import { PendingPadScene } from "../lib/pending-pad-escape"
import type { Connection, Point, SimpleRouteJson, Trace } from "../lib/types"
import {
  pendingPadAccessFixture,
  rotatePendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

function foreignVia(): Trace {
  return {
    type: "pcb_trace",
    pcb_trace_id: "foreign_via",
    connection_name: "FOREIGN_NET",
    source_trace_id: "foreign_alias",
    route: [
      {
        route_type: "via",
        x: 2,
        y: -1,
        from_layer: "top",
        to_layer: "inner1",
        layers: ["top", "inner1"],
        via_diameter: 0.6,
        via_hole_diameter: 0.2,
      },
    ],
  }
}

test("prepared copper retains explicit via spans without applying a non-plated-hole rule", () => {
  const { input } = pendingPadAccessFixture()
  input.layerCount = 4
  input.minTraceToHoleEdgeClearance = 0.4
  input.traces = [foreignVia()]
  const geometry = new PendingPadGeometry(input)
  const via = input.traces[0].route[0]
  const shapes = geometry.traceSceneCopper.filter(
    (shape) => shape.a === via && shape.b === via,
  )

  expect(geometry.physical).toEqual(["top", "inner1", "inner2", "bottom"])
  expect(shapes.map((shape) => shape.layer)).toEqual(["top", "inner1"])
  for (const land of shapes) {
    expect(land.radius).toBeCloseTo(0.3, 12)
    expect(land.owners).toEqual(["FOREIGN_NET", "foreign_alias"])
  }
  if (via.route_type !== "via") throw Error("Fixture must provide a via")
  expect(geometry.oldVias).toEqual([via])
  expect(geometry.padsAndVias.length - geometry.padCopper.length).toBe(2)
  expect(geometry.wireCopper).toEqual([])
})

test("prepared landing scenes keep via-pad rules separate from ordinary wire and NPTH rules", () => {
  const { input } = pendingPadAccessFixture()
  input.minViaEdgeToPadEdgeClearance = 0.3
  input.minPadEdgeToPadEdgeClearance = 0.4
  input.minTraceToHoleEdgeClearance = 0.4
  const geometry = new PendingPadGeometry(input)
  // Via-specific rules override generic pads; the NPTH rule is not a new-via
  // drill exclusion and does not alter the ordinary wire policy.
  expect(geometry.landingInput.minTraceToPadEdgeClearance).toBe(0.3)
  expect(input.minTraceToPadEdgeClearance).toBe(0.1)

  const ordinary = new PendingPadGeometry({
    ...input,
    minTraceToHoleEdgeClearance: 0.1,
  })
  expect(ordinary.viaDiameter).toBe(0.4)
  expect(ordinary.holeDiameter).toBe(0.2)
})

function compareScenes({
  input,
  connection,
  geometry,
  layer,
}: {
  input: SimpleRouteJson
  connection: Connection
  geometry: PendingPadGeometry
  layer: string
}): void {
  const request = { input, connection, terminalIndex: 0, terminalLayer: layer }
  const fresh = new PendingPadScene(request)
  const shared = new PendingPadScene(request, geometry)
  expect(shared.width).toBe(fresh.width)
  expect(shared.physical).toBe(geometry.physical)
  expect(shared.carrierLayers).toEqual(fresh.carrierLayers)
  expect(shared.frame).toEqual(fresh.frame)
  expect(shared.scene.copper).toEqual(fresh.scene.copper)
  expect(
    shared.scene.copper.every((shape) =>
      geometry.traceSceneCopper.includes(shape),
    ),
  ).toBe(true)
  const probes: Point[] = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: -1 },
    { x: -3, y: -3 },
    { x: 3, y: 0 },
  ]
  for (const point of probes) {
    expect(shared.scene.visible(point, point)).toBe(
      fresh.scene.visible(point, point),
    )
    expect(shared.scene.visible(connection.pointsToConnect[0], point)).toBe(
      fresh.scene.visible(connection.pointsToConnect[0], point),
    )
    expect(shared.surfaceExit(point)).toBe(fresh.surfaceExit(point))
    for (const target of geometry.physical)
      expect(shared.viaSpan(point, target)).toEqual(
        fresh.viaSpan(point, target),
      )
  }
}

test("shared preparation preserves fresh scene behavior across widths, layers, rules and rotations", () => {
  for (const ccwRotationDegrees of [0, 45]) {
    const { input, pendingConnection } = rotatePendingPadAccessFixture(
      pendingPadAccessFixture(),
      ccwRotationDegrees,
    )
    input.layerCount = 4
    input.allowedLayers = ["top", "inner1", "bottom"]
    input.minTraceToHoleEdgeClearance = 0.35
    input.minViaEdgeToPadEdgeClearance = 0.3
    input.minPadEdgeToPadEdgeClearance = 0.2
    input.traces = [foreignVia()]
    const geometry = new PendingPadGeometry(input)
    const original = JSON.stringify(input)
    for (const width of [0.1, 0.2])
      for (const layer of geometry.physical)
        compareScenes({
          input,
          connection: { ...pendingConnection, width },
          geometry,
          layer,
        })
    const first = new PendingPadScene(
      { input, connection: pendingConnection, terminalIndex: 0 },
      geometry,
    )
    const second = new PendingPadScene(
      { input, connection: pendingConnection, terminalIndex: 1 },
      geometry,
    )
    expect(first.frame).toBe(geometry.frameByComponent.get("CPU"))
    expect(second.frame).toBe(geometry.frameByComponent.get("RAM"))
    expect(geometry.frameByComponent.size).toBe(2)
    expect(JSON.stringify(input)).toBe(original)
  }
})

test("a prepared union rejects another input even when its geometry compares equal", () => {
  const { input, pendingConnection } = pendingPadAccessFixture()
  const geometry = new PendingPadGeometry(input)
  expect(() => geometry.assertMatches(input)).not.toThrow()
  expect(() => geometry.assertMatches({ ...input })).toThrow("different input")
  expect(
    () =>
      new PendingPadScene(
        {
          input: { ...input },
          connection: pendingConnection,
          terminalIndex: 0,
        },
        geometry,
      ),
  ).toThrow("different input")
})

test("prepared unions reject reused leased views and changed rules before any scene uses them", () => {
  const mutations: Array<{
    field: string
    apply(input: SimpleRouteJson): void
  }> = [
    {
      field: "traces",
      apply: (input) => {
        input.traces = [...(input.traces ?? [])]
      },
    },
    {
      field: "obstacles",
      apply: (input) => {
        input.obstacles = [...input.obstacles]
      },
    },
    {
      field: "bounds",
      apply: (input) => {
        input.bounds = { ...input.bounds }
      },
    },
    {
      field: "outline",
      apply: (input) => {
        input.outline = [...input.outline!]
      },
    },
    {
      field: "minTraceToPadEdgeClearance",
      apply: (input) => {
        input.minTraceToPadEdgeClearance = 0.2
      },
    },
    {
      field: "minTraceToHoleEdgeClearance",
      apply: (input) => {
        input.minTraceToHoleEdgeClearance = 0.3
      },
    },
    {
      field: "minViaEdgeToPadEdgeClearance",
      apply: (input) => {
        input.minViaEdgeToPadEdgeClearance = 0.4
      },
    },
    {
      field: "minViaPadDiameter",
      apply: (input) => {
        input.minViaPadDiameter = 0.5
      },
    },
    {
      field: "allowBlindAndBuriedVias",
      apply: (input) => {
        input.allowBlindAndBuriedVias = true
      },
    },
  ]
  for (const mutation of mutations) {
    const { input, pendingConnection } = pendingPadAccessFixture()
    const geometry = new PendingPadGeometry(input)
    mutation.apply(input)
    expect(() => geometry.assertMatches(input)).toThrow(mutation.field)
    expect(
      () =>
        new PendingPadScene(
          { input, connection: pendingConnection, terminalIndex: 0 },
          geometry,
        ),
    ).toThrow(mutation.field)
  }
})
