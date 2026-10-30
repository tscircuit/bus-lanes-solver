import type { SimpleRouteJson } from "../../lib"

export function boardOutlineInput(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -4, maxY: 4 },
    outline: [
      { x: -5, y: -4 },
      { x: 5, y: -4 },
      { x: 5, y: 4 },
      { x: 1, y: 4 },
      { x: 1, y: -1 },
      { x: -1, y: -1 },
      { x: -1, y: 4 },
      { x: -5, y: 4 },
    ],
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -3, y: 1, layer: "top" },
          { x: 3, y: 1, layer: "top" },
        ],
      },
    ],
  }
}
