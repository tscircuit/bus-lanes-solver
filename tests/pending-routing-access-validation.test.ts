import { expect, test } from "bun:test"
import type { PendingRoutingAccess } from "../lib/types"
import {
  InvalidPendingRoutingAccess,
  validatePendingRoutingAccess,
} from "../lib/validate-pending-routing-access"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

test("future physical metadata cannot erase access obligations with invalid geometry or rules", () => {
  const { input } = pendingPadAccessFixture()
  const invalid: Array<{
    name: string
    mutate: (intent: PendingRoutingAccess) => void
  }> = [
    {
      name: "nonfinite minimum width",
      mutate: (g) => {
        g.minTraceWidth = Number.NaN
      },
    },
    {
      name: "zero connection width",
      mutate: (g) => {
        g.connections[0]!.width = 0
      },
    },
    {
      name: "negative nominal width",
      mutate: (g) => {
        g.connections[0]!.nominalTraceWidth = -0.1
      },
    },
    {
      name: "negative clearance",
      mutate: (g) => {
        g.minTraceToPadEdgeClearance = -1
      },
    },
    {
      name: "infinite clearance",
      mutate: (g) => {
        g.minViaHoleEdgeToViaHoleEdgeClearance = Infinity
      },
    },
    {
      name: "invalid land",
      mutate: (g) => {
        g.minViaPadDiameter = 0
      },
    },
    {
      name: "drill outside land",
      mutate: (g) => {
        g.minViaHoleDiameter = 1
      },
    },
    {
      name: "zero-area bounds",
      mutate: (g) => {
        g.bounds.maxX = g.bounds.minX
      },
    },
    {
      name: "nonfinite bounds",
      mutate: (g) => {
        g.bounds.maxY = Infinity
      },
    },
    {
      name: "crossed outline",
      mutate: (g) => {
        g.outline = [
          { x: 0, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
          { x: 2, y: 0 },
        ]
      },
    },
    {
      name: "unknown allowed layer",
      mutate: (g) => {
        g.allowedLayers = ["inner99"]
      },
    },
    {
      name: "empty allowed domain",
      mutate: (g) => {
        g.allowedLayers = []
      },
    },
    {
      name: "duplicate connection name",
      mutate: (g) => {
        g.connections.push(structuredClone(g.connections[0]!))
      },
    },
    {
      name: "no native terminals",
      mutate: (g) => {
        g.connections[0]!.pointsToConnect = []
      },
    },
    {
      name: "nonfinite terminal",
      mutate: (g) => {
        g.connections[0]!.pointsToConnect[0]!.x = Infinity
      },
    },
    {
      name: "unknown terminal layer",
      mutate: (g) => {
        g.connections[0]!.pointsToConnect[0]!.layer = "inner99"
      },
    },
    {
      name: "empty native layers",
      mutate: (g) => {
        g.connections[0]!.pointsToConnect[0]!.layers = []
      },
    },
    {
      name: "missing primary layer",
      mutate: (g) => {
        g.connections[0]!.pointsToConnect[0]!.layers = ["bottom"]
      },
    },
    {
      name: "unknown bus member",
      mutate: (g) => {
        g.buses = [{ busId: "data", connectionNames: ["missing"] }]
      },
    },
    {
      name: "invalid bus width",
      mutate: (g) => {
        g.buses = [
          {
            busId: "data",
            connectionNames: [g.connections[0]!.name],
            traceWidth: Number.NaN,
          },
        ]
      },
    },
    {
      name: "empty bus domain",
      mutate: (g) => {
        g.buses = [
          {
            busId: "data",
            connectionNames: [g.connections[0]!.name],
            allowedLayers: [],
          },
        ]
      },
    },
    {
      name: "disjoint owning bus domains",
      mutate: (g) => {
        g.buses = ["top", "bottom"].map((layer) => ({
          busId: layer,
          connectionNames: [g.connections[0]!.name],
          allowedLayers: [layer],
        }))
      },
    },
  ]
  for (const { name, mutate } of invalid) {
    const malformed = structuredClone(input)
    mutate(malformed.pendingRoutingAccess![0]!)
    const before = structuredClone(malformed)
    let error: Error | undefined
    try {
      validatePendingRoutingAccess(malformed)
    } catch (caught) {
      if (!(caught instanceof Error)) throw caught
      error = caught
    }
    expect(error, name).toBeInstanceOf(InvalidPendingRoutingAccess)
    expect(error?.message, name).toContain("Invalid pending routing access")
    expect(malformed, name).toEqual(before)
  }
  // Real JSON callers can supply fields that contradict the structural type.
  const malformedBoolean = {
    ...input,
    pendingRoutingAccess: JSON.parse(
      JSON.stringify(input.pendingRoutingAccess).replace(
        '"allowViaInPad":false',
        '"allowViaInPad":"false"',
      ),
    ),
  }
  expect(() => validatePendingRoutingAccess(malformedBoolean)).toThrow(
    InvalidPendingRoutingAccess,
  )
  expect(() => validatePendingRoutingAccess(input)).not.toThrow()
  expect(() =>
    validatePendingRoutingAccess({
      ...input,
      layerCount: Number.NaN,
      pendingRoutingAccess: undefined,
    }),
  ).not.toThrow()
  expect(() =>
    validatePendingRoutingAccess({ ...input, pendingRoutingAccess: [] }),
  ).not.toThrow()
  // Multiple owning buses are valid; their physical layer domains intersect.
  const overlapping = structuredClone(input)
  overlapping.pendingRoutingAccess![0]!.buses = [0.12, 0.14].map(
    (traceWidth, index) => ({
      busId: `data_${index}`,
      connectionNames: [
        overlapping.pendingRoutingAccess![0]!.connections[0]!.name,
      ],
      traceWidth,
      allowedLayers: ["top", "bottom"],
    }),
  )
  expect(() => validatePendingRoutingAccess(overlapping)).not.toThrow()
  expect(new InvalidPendingRoutingAccess("test").failureCode).toBe(
    "invalid_pending_routing_access",
  )
})
