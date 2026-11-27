import { expect, test } from "bun:test"
import { GridVisibilitySearch } from "../lib/grid-visibility"
import { VectorScene, fixedCopper } from "../lib/vector-scene"
import type { SimpleRouteJson } from "../lib/types"

test("routing retains a narrow BGA channel independently of board origin", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.0975,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -0.1, maxX: 0.75, minY: -1.8, maxY: 1.8 },
    obstacles: [0, 0.65].flatMap((x) =>
      [0, 0.65].map((y) => ({
        componentId: "U1",
        center: { x, y },
        width: 0.3,
        height: 0.3,
        layers: ["bottom"],
        connectedTo: [],
      })),
    ),
    traces: [0, 0.65].map((x) => ({
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
          via_diameter: 0.35,
        },
      ],
    })),
    connections: [
      {
        name: "D",
        pointsToConnect: [
          { x: 0.1, y: -1.5, layer: "top" },
          { x: 0.55, y: 1.5, layer: "top" },
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
  expect(scene.visible(start, end)).toBeFalse()
  const solver = new GridVisibilitySearch(scene, start, end, [], 0)
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.solved).toBeTrue()
  expect(scene.pathVisible(solver.result)).toBeTrue()
})
