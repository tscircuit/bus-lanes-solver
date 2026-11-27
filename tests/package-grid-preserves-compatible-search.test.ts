import { expect, test } from "bun:test"
import { GridVisibilitySearch } from "../lib/grid-visibility"
import { VectorScene, fixedCopper } from "../lib/vector-scene"
import type { SimpleRouteJson } from "../lib/types"

test("a compatible package pitch preserves the existing routing raster", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.08,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -0.1, maxX: 1.2, minY: -1.8, maxY: 1.8 },
    obstacles: [0.13, 0.93].flatMap((x) =>
      [0, 0.8].map((y) => ({
        componentId: "U1",
        center: { x, y },
        width: 0.3,
        height: 0.3,
        layers: ["bottom"],
        connectedTo: [],
      })),
    ),
    traces: [0.13, 0.93].map((x) => ({
      type: "pcb_trace",
      pcb_trace_id: `fixed-${x}`,
      connection_name: `other-${x}`,
      route: [
        {
          route_type: "via",
          x,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.45,
        },
      ],
    })),
    connections: [
      {
        name: "D",
        pointsToConnect: [
          { x: 0.13, y: -1.5, layer: "top" },
          { x: 0.93, y: 1.5, layer: "top" },
        ],
      },
    ],
  }
  const scene = new VectorScene(
    input,
    input.connections[0],
    input.minTraceWidth,
    fixedCopper(input),
  )
  const [start, end] = input.connections[0].pointsToConnect
  const existing = new GridVisibilitySearch(
    scene,
    start,
    end,
    [],
    0,
    undefined,
    { step: 0.04 },
  )
  const automatic = new GridVisibilitySearch(scene, start, end, [], 0)
  for (const search of [existing, automatic]) {
    while (!search.solved && !search.failed) search.step()
    expect(search.solved).toBeTrue()
    expect(scene.pathVisible(search.result)).toBeTrue()
  }
  expect(automatic.result).toEqual(existing.result)
})
