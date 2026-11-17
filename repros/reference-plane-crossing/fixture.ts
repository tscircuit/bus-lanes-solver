import type {
  Connection,
  Obstacle,
  SimpleRouteJson,
  Trace,
} from "../../lib/types"

/** These are electrical/reference requirements, deliberately outside the SRJ API. */
export const referenceRequirement = {
  signalLayer: "bottom",
  referenceLayer: "inner2",
  referenceNet: "GND",
  foreignNet: "V1V8",
  pourClearanceMm: 0.155,
} as const

export const fixedPower: Trace = {
  type: "pcb_trace",
  pcb_trace_id: "fixed_inner2_supply",
  connection_name: "V1V8",
  route: [
    { route_type: "wire", x: 0, y: -1, layer: "inner2", width: 0.2 },
    { route_type: "wire", x: 0, y: 1, layer: "inner2", width: 0.2 },
  ],
}

export const powerConnection: Connection = {
  name: "V1V8",
  pointsToConnect: [
    { x: 0, y: -1, layer: "inner2" },
    { x: 0, y: 1, layer: "inner2" },
  ],
}

/** The fixed supply is not a requested signal in this routing phase. */
export function crossingInput(): SimpleRouteJson {
  return {
    layerCount: 4,
    allowedLayers: ["bottom"],
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "DDR_A0",
        pointsToConnect: [
          { x: -4, y: 0, layer: "bottom" },
          { x: 4, y: 0, layer: "bottom" },
        ],
      },
    ],
    buses: [
      {
        busId: "DDR_CA",
        connectionNames: ["DDR_A0"],
        allowedLayers: ["bottom"],
      },
    ],
    traces: [structuredClone(fixedPower)],
  }
}

/** Conservative rectangle enclosing the round-ended hole in GND coverage.
 * This is a caller-supplied electrical keepout, not additional physical copper.
 * The independent audit uses the exact capsule rather than this rectangle. */
export function projectedCut(layer = "bottom"): Obstacle {
  const diameter = 0.2 + 2 * referenceRequirement.pourClearanceMm
  return {
    type: "reference_projection",
    center: { x: 0, y: 0 },
    width: diameter,
    height: 2 + diameter,
    layers: [layer],
    connectedTo: [],
  }
}
