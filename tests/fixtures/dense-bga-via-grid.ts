import type { Connection, SimpleRouteJson } from "../../lib"
import type { BusLanesPipelineOptions } from "../../lib/bus-lanes-pipeline-solver"

/** OrangeCrab U3 dimensions: 0.5 mm pitch, 0.23 mm pads, 0.28 mm via lands.
 * Fixed lands on another plane leave legal pockets between the BGA pads.
 * The explicit paired handoff isolates terminal search from trunk planning. */
export function denseBgaViaGrid(): {
  input: SimpleRouteJson
  options: BusLanesPipelineOptions
} {
  const input: SimpleRouteJson = {
    layerCount: 6,
    minTraceWidth: 0.089,
    minViaPadDiameter: 0.28,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.089,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.18,
    allowViaInPad: false,
    allowedLayers: ["inner2"],
    bounds: { minX: -2.136, maxX: 8.9, minY: -2.136, maxY: 2.136 },
    obstacles: [],
    traces: [],
    connections: [
      {
        name: "P",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 5, y: -0.4, layer: "top" },
        ],
      },
      {
        name: "N",
        pointsToConnect: [
          { x: 0.5, y: 0, layer: "top" },
          { x: 5, y: 0.4, layer: "top" },
        ],
      },
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.089, lengthTolerance: 1 },
    ],
  }
  const fixedConnections: Connection[] = []
  for (const x of [-0.5, 0, 0.5])
    for (const y of [-0.5, 0, 0.5]) {
      const name = `fixed_land_${fixedConnections.length}`
      input.obstacles.push({
        type: "rect",
        shape: "circle",
        componentId: "bga",
        center: { x, y },
        width: 0.23,
        height: 0.23,
        layers: ["top"],
        connectedTo:
          y === 0 && x === 0
            ? ["P"]
            : y === 0 && x === 0.5
              ? ["N"]
              : [`pad_${x}_${y}`],
      })
      const points = [
        { x, y, layer: "inner1" },
        { x: x + 0.0001, y, layer: "inner1" },
      ]
      fixedConnections.push({ name, pointsToConnect: points })
      input.traces!.push({
        type: "pcb_trace",
        pcb_trace_id: name,
        connection_name: name,
        route: points.map((point) => ({
          ...point,
          route_type: "wire",
          width: 0.23,
        })),
      })
    }
  for (const connection of input.connections)
    input.obstacles.push({
      type: "rect",
      shape: "circle",
      componentId: "target",
      center: connection.pointsToConnect[1],
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: [connection.name],
    })
  return {
    input,
    options: {
      maxRoutingTimeMs: 30000,
      singleCarrier: {
        fixedConnections,
        centerlines: [[{ x: 0.835, y: 0 }, { x: 4.6, y: 0 }]],
      },
    },
  }
}
