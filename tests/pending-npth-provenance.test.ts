import { expect, test } from "bun:test"
import { PendingPadScene } from "../lib/pending-pad-escape"
import type { SimpleRouteJson } from "../lib/types"

function fixture(sharedCenter: boolean): SimpleRouteJson {
  const center = { x: 2, y: 0.3 }
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minTraceToHoleEdgeClearance: 0,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    connections: [
      {
        name: "FUTURE",
        width: 0.1,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        isNonPlatedHole: true,
        center,
        width: 0.2,
        height: 0.2,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
      {
        type: "rect",
        center: sharedCenter ? center : { ...center },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["OTHER"],
      },
    ],
  }
}

function visible(input: SimpleRouteJson): boolean {
  return new PendingPadScene({
    input,
    connection: input.connections[0],
    terminalIndex: 0,
  }).scene.pathVisible([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
  ])
}

test("sharing a Point object cannot transfer an NPTH rule to a different physical pad", () => {
  for (const sharedCenter of [false, true]) {
    const input = fixture(sharedCenter)
    const original = structuredClone(input)
    expect(
      visible({
        ...input,
        obstacles: input.obstacles.filter(
          (obstacle) => obstacle.isNonPlatedHole,
        ),
      }),
    ).toBe(true)
    // The trace clears the hole, but its gap to foreign pad copper is 0.05mm,
    // below that pad's independent 0.1mm clearance in both object layouts.
    expect(visible(input)).toBe(false)
    expect(input).toEqual(original)
  }
})
