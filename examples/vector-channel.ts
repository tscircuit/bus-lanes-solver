import type { SimpleRouteJson } from "../lib"
export const channelInput = (offset = 0): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.06,
  defaultObstacleMargin: 0.02,
  bounds: {
    minX: -1 + offset,
    maxX: 11 + offset,
    minY: -3 + offset,
    maxY: 3 + offset,
  },
  connections: [0, 1, 2].map((i) => ({
    name: `lane${i}`,
    pointsToConnect: [
      { x: offset, y: -0.4 + i * 0.4 + offset, layer: "top" },
      { x: 10 + offset, y: 0.2 + i * 0.4 + offset, layer: "top" },
    ],
  })),
  obstacles: [
    {
      center: { x: 4 + offset, y: 0.2 + offset },
      width: 1.7,
      height: 0.8,
      layers: ["top"],
      connectedTo: [],
    },
    {
      center: { x: 7 + offset, y: -1.8 + offset },
      width: 1.1,
      height: 1.1,
      layers: ["top"],
      connectedTo: [],
    },
  ],
})
