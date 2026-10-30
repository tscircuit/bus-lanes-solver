import type { SimpleRouteJson } from "../../lib"

export function nativeOvalObstacle(): SimpleRouteJson {
  return {
    layerCount: 6,
    allowedLayers: ["inner2"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1.5, y: 1.5, layer: "inner2" },
          { x: -0.5, y: 1.5, layer: "inner2" },
        ],
      },
    ],
    obstacles: [
      {
        type: "oval",
        center: { x: 0, y: 0 },
        width: 6,
        height: 0.5,
        ccwRotationDegrees: 45,
        layers: ["inner2"],
        connectedTo: ["immutable_copper"],
      },
    ],
  }
}
