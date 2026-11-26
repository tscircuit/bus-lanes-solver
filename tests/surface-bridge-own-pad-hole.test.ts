import { expect, test } from "bun:test"
import { distance } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { routeSurfaceBridge } from "../lib/route-surface-bridge"
import type { SimpleRouteJson } from "../lib/types"

test("surface handoff drills stay outside the full same-net pad rather than only its center", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.1,
        height: 4,
        layers: ["top"],
        connectedTo: ["wall"],
      },
      {
        type: "rect",
        shape: "circle",
        componentId: "source",
        center: { x: -1, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["signal"],
      },
      {
        type: "rect",
        shape: "circle",
        componentId: "target",
        center: { x: 1, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["signal"],
      },
    ],
  }
  const search = routeSurfaceBridge(input, input.connections[0])
  let step = search.next()
  while (!step.done) step = search.next()
  expect(step.value).not.toBeNull()
  const trace = joinSignalEscapes(step.value!.carrier, step.value!.escapes)
  const vias = trace.route.filter((point) => point.route_type === "via")
  expect(vias).toHaveLength(2)
  for (const via of vias) {
    expect(
      distance(via, input.connections[0].pointsToConnect[0]),
    ).toBeGreaterThan(0.275)
    expect(
      distance(via, input.connections[0].pointsToConnect[1]),
    ).toBeGreaterThan(0.275)
  }
})
