import { expect, test } from "bun:test"
import {
  validatePendingTerminalWitness,
  type PendingWitnessValidationRequest,
} from "./fixtures/pending-access-certificates"
import type { Connection, Obstacle, SimpleRouteJson } from "../lib/types"

function fixture(): PendingWitnessValidationRequest {
  const connection: Connection = {
    name: "FUTURE",
    source_trace_id: "source-future",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "cpu-native" },
      { x: 3, y: 0, layer: "top", pcb_port_id: "ram-native" },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      componentId: "CPU",
      center: { x: 0, y: 0 },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: ["cpu-native"],
    },
    {
      type: "rect",
      componentId: "CPU",
      center: { x: -0.5, y: 0.5 },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: ["other1"],
    },
    {
      type: "rect",
      componentId: "CPU",
      center: { x: 0.5, y: 0.5 },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: ["other2"],
    },
    {
      type: "rect",
      componentId: "RAM",
      center: { x: 3, y: 0 },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: ["ram-native"],
    },
  ]
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [],
    obstacles,
    pendingRoutingAccess: [
      {
        connections: [connection],
        minTraceWidth: 0.1,
        minTraceToPadEdgeClearance: 0.05,
        bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
        allowedLayers: ["top"],
        allowViaInPad: false,
      },
    ],
  }
  return {
    input,
    traces: [],
    phaseIndex: 0,
    connection,
    terminalIndex: 0,
    witness: {
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      layer: "top",
    },
  }
}

function phase(request: PendingWitnessValidationRequest) {
  return request.input.pendingRoutingAccess![0]
}

test("surface certificate independently proves original field exit and native origin", () => {
  const request = fixture(),
    before = JSON.stringify(request)
  const valid = validatePendingTerminalWitness(request)
  expect(valid.valid).toBe(true)
  expect(valid.field?.bounds.maxX).toBe(0.6)
  expect(valid.drc?.valid).toBe(true)
  expect(JSON.stringify(request)).toBe(before)
  expect(
    validatePendingTerminalWitness({
      ...request,
      witness: {
        path: [
          { x: 0.001, y: 0 },
          { x: 1, y: 0 },
        ],
        layer: "top",
      },
    }).issues,
  ).toContain("witness-does-not-start-at-exact-terminal")
  expect(
    validatePendingTerminalWitness({
      ...request,
      witness: {
        path: [
          { x: 0, y: 0 },
          { x: 0.64, y: 0 },
        ],
        layer: "top",
      },
    }).issues,
  ).toContain("surface-end-is-not-outside-original-pad-field")
  expect(
    validatePendingTerminalWitness({
      ...request,
      witness: {
        path: [
          { x: 0, y: 0 },
          { x: 0.650000001, y: 0 },
        ],
        layer: "top",
      },
    }).issues,
  ).toContain("surface-end-is-not-outside-original-pad-field")
  expect(
    validatePendingTerminalWitness({
      ...request,
      witness: {
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        layer: "bottom",
      },
    }).issues,
  ).toContain("witness-layer-is-not-native")
  request.connection.pointsToConnect[0].layers = ["top", "bottom"]
  phase(request).allowedLayers = ["bottom"]
  expect(
    validatePendingTerminalWitness({
      ...request,
      witness: {
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        layer: "top",
      },
    }).issues,
  ).toContain("surface-exit-outside-carrier-policy")
})

test("a smaller via-pad rule does not weaken continuous future-wire clearance", () => {
  const request = fixture()
  phase(request).minViaEdgeToPadEdgeClearance = 0
  request.input.obstacles.push({
    type: "rect",
    center: { x: 0.5, y: 0.13 },
    width: 0.1,
    height: 0.1,
    layers: ["top"],
    connectedTo: ["FOREIGN"],
  })
  const result = validatePendingTerminalWitness(request)
  expect(result.drcClearanceFloorMm).toBe(0)
  expect(result.drc?.valid).toBe(true)
  expect(result.issues).toContain("future-wire-to-existing-pad")
  expect(result.valid).toBe(false)
})

test("first owning bus width and all owning bus carrier constraints are independent", () => {
  const request = fixture(),
    intent = phase(request)
  request.connection.width = 0.4
  request.connection.nominalTraceWidth = 0.2
  intent.buses = [
    {
      busId: "first",
      connectionNames: ["FUTURE"],
      traceWidth: 0.3,
      allowedLayers: ["top"],
    },
    {
      busId: "second",
      connectionNames: ["FUTURE"],
      traceWidth: 0.5,
      allowedLayers: ["top", "bottom"],
    },
  ]
  const first = validatePendingTerminalWitness(request)
  expect(first.widthMm).toBe(0.3)
  expect(first.widthSource).toBe("first-owning-bus")
  expect(first.valid).toBe(true)
  delete intent.buses[0].traceWidth
  expect(validatePendingTerminalWitness(request).widthMm).toBe(0.2)
  delete request.connection.nominalTraceWidth
  expect(validatePendingTerminalWitness(request).widthMm).toBe(0.4)
  delete request.connection.width
  expect(validatePendingTerminalWitness(request).widthMm).toBe(0.1)
  intent.buses[1].allowedLayers = ["bottom"]
  const forbidden = validatePendingTerminalWitness(request)
  expect(forbidden.carrierLayers).toEqual([])
  expect(forbidden.issues).toContain("surface-exit-outside-carrier-policy")
})

test("new via certificate checks endpoint, future defaults, in-pad and physical span", () => {
  const request = fixture(),
    intent = phase(request)
  intent.allowedLayers = ["bottom"]
  request.witness = {
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    layer: "top",
    via: { point: { x: 1, y: 0 }, layers: ["top", "bottom"] },
  }
  expect(validatePendingTerminalWitness(request).valid).toBe(true)
  intent.minViaHoleDiameter = 0.4
  expect(validatePendingTerminalWitness(request).issues).toContain(
    "invalid-new-via-dimensions",
  )
  delete intent.minViaHoleDiameter
  request.witness.via!.point.x = 1.01
  expect(validatePendingTerminalWitness(request).issues).toContain(
    "via-is-not-at-exact-path-end",
  )
  request.witness.via!.point.x = 1
  request.input.layerCount = 4
  expect(validatePendingTerminalWitness(request).issues).toContain(
    "new-via-span-or-carrier-policy",
  )
  intent.allowBlindAndBuriedVias = true
  intent.allowedLayers = ["inner1"]
  request.witness.via!.layers = ["top", "inner1"]
  expect(validatePendingTerminalWitness(request).valid).toBe(true)
  request.witness.path = [{ x: 0, y: 0 }]
  request.witness.via!.point = { x: 0, y: 0 }
  expect(validatePendingTerminalWitness(request).issues).toContain(
    "forbidden-new-via-in-pad",
  )
})

test("future carrier handoff uses wire width even when new via land is narrower", () => {
  const request = fixture(),
    intent = phase(request)
  request.connection.nominalTraceWidth = 0.6
  intent.allowedLayers = ["bottom"]
  request.witness = {
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    layer: "top",
    via: { point: { x: 1, y: 0 }, layers: ["top", "bottom"] },
  }
  request.input.obstacles.push({
    type: "rect",
    center: { x: 1, y: 0.32 },
    width: 0.1,
    height: 0.1,
    layers: ["bottom"],
    connectedTo: ["GND"],
  })
  const result = validatePendingTerminalWitness(request)
  expect(result.drc?.valid).toBe(true)
  expect(result.issues).toContain("future-carrier-handoff-width-clearance")
})

test("shortcut witnesses and unknown original obstacles are rejected without manufactured probes", () => {
  const request = fixture()
  for (const marker of [
    { ownedCarrier: { point: { x: 1, y: 0 }, layer: "top" } },
    { existingEgress: { point: { x: 1, y: 0 }, layer: "top" } },
    { existingCompleteConnection: true as const },
  ]) {
    const result = validatePendingTerminalWitness({
      ...request,
      witness: { ...request.witness!, ...marker },
    })
    expect(result.valid).toBe(false)
    expect(result.issues).toContain("unsupported-owned-copper-shortcut")
    expect(result.drc).toBeUndefined()
  }
  request.input.obstacles[0].type = "circle"
  expect(() => validatePendingTerminalWitness(request)).toThrow(
    "original rect obstacle tags",
  )
})

test("original rotated pad-field is checked in its physical package frame", () => {
  const request = fixture(),
    cosine = Math.SQRT1_2
  for (const pad of request.input.obstacles.filter(
    (pad) => pad.componentId === "CPU",
  )) {
    pad.center = {
      x: (pad.center.x - pad.center.y) * cosine,
      y: (pad.center.x + pad.center.y) * cosine,
    }
    pad.ccwRotationDegrees = 45
  }
  request.witness = {
    path: [
      { x: 0, y: 0 },
      { x: cosine, y: cosine },
    ],
    layer: "top",
  }
  const result = validatePendingTerminalWitness(request)
  expect(result.valid).toBe(true)
  expect(result.field?.rotationRadians).toBeCloseTo(Math.PI / 4)
  request.witness.path[1] = { x: 0.64 * cosine, y: 0.64 * cosine }
  expect(validatePendingTerminalWitness(request).issues).toContain(
    "surface-end-is-not-outside-original-pad-field",
  )
})

test("specific via-pad and drill spacing rules supplement official ordinary-copper DRC", () => {
  const request = fixture(),
    intent = phase(request)
  intent.allowedLayers = ["bottom"]
  request.witness = {
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    layer: "top",
    via: { point: { x: 1, y: 0 }, layers: ["top", "bottom"] },
  }
  request.input.obstacles.push({
    type: "rect",
    center: { x: 1, y: 0.4 },
    width: 0.1,
    height: 0.1,
    layers: ["bottom"],
    connectedTo: ["GND"],
  })
  intent.minViaEdgeToPadEdgeClearance = 0.25
  const padResult = validatePendingTerminalWitness(request)
  expect(padResult.drc?.valid).toBe(true)
  expect(padResult.issues).toContain("future-via-specific-pad-clearance")
  delete intent.minViaEdgeToPadEdgeClearance
  intent.minTraceToHoleEdgeClearance = 0.3
  const padDrillResult = validatePendingTerminalWitness(request)
  expect(padDrillResult.drc?.valid).toBe(true)
  expect(padDrillResult.valid).toBe(true)
  request.input.obstacles.pop()
  delete intent.minTraceToHoleEdgeClearance
  request.fixedConnections = [
    {
      name: "OLD",
      pointsToConnect: [
        { x: 2, y: 2, layer: "top" },
        { x: 2, y: 1, layer: "bottom" },
      ],
    },
  ]
  request.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed",
      connection_name: "OLD",
      route: [
        { route_type: "wire", x: 2, y: 2, layer: "top", width: 0.1 },
        { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
        {
          route_type: "via",
          x: 2,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          layers: ["top", "bottom"],
          via_diameter: 0.8,
          via_hole_diameter: 0.6,
        },
        { route_type: "wire", x: 2, y: 0, layer: "bottom", width: 0.1 },
        { route_type: "wire", x: 2, y: 1, layer: "bottom", width: 0.1 },
      ],
    },
  ]
  intent.minPlatedHoleDrillEdgeToDrillEdgeClearance = 0.7
  expect(validatePendingTerminalWitness(request).valid).toBe(true)
  intent.minViaHoleEdgeToViaHoleEdgeClearance = 0.7
  const drillResult = validatePendingTerminalWitness(request)
  expect(drillResult.drc?.valid).toBe(true)
  expect(drillResult.issues).toContain("future-drill-to-existing-drill")
  delete intent.minPlatedHoleDrillEdgeToDrillEdgeClearance
  delete intent.minViaHoleEdgeToViaHoleEdgeClearance
  intent.minTraceToHoleEdgeClearance = 0.95
  expect(validatePendingTerminalWitness(request).valid).toBe(true)
  expect(() =>
    validatePendingTerminalWitness({ ...request, fixedConnections: [] }),
  ).toThrow("supply fixedConnections")
})
