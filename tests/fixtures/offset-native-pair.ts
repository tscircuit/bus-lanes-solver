import type { SimpleRouteJson } from "../../lib"

export function offsetNativePair(): SimpleRouteJson {
  const connections = ["P", "N"].map((name, i) => ({
    name,
    pointsToConnect: [
      { x: -6, y: -1.5 + i, layer: "top" },
      { x: 6, y: 0.5 + i, layer: "top" },
    ],
  }))
  return {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minBoardEdgeClearance: 0.2,
    allowViaInPad: false,
    bounds: { minX: -8, maxX: 8, minY: -5, maxY: 5 },
    outline: [
      { x: -8, y: -4 },
      { x: -7, y: -5 },
      { x: 7, y: -5 },
      { x: 8, y: -4 },
      { x: 8, y: 4 },
      { x: 7, y: 5 },
      { x: -7, y: 5 },
      { x: -8, y: 4 },
    ],
    connections,
    obstacles: connections.flatMap((c) =>
      c.pointsToConnect.map((p, i) => ({
        type: "rect",
        shape: "circle" as const,
        componentId: `package_${i}`,
        center: { x: p.x, y: p.y },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: [c.name],
      })),
    ),
    differentialPairs: [
      {
        connectionNames: ["P", "N"],
        lengthTolerance: 0.1,
        traceGap: 0.1,
      },
    ],
    buses: [
      {
        busId: "DQS",
        connectionNames: ["P", "N"],
        maxLengthSkew: 0.1,
      },
    ],
  }
}
