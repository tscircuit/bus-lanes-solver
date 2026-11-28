import { expect, test } from "bun:test"
import { withSkewRoundoffReserve } from "../lib/skew-roundoff-reserve"
import type { SimpleRouteJson } from "../lib/types"

function plainBusInput(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "D0",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 0, layer: "top" },
        ],
      },
      {
        name: "D1",
        pointsToConnect: [
          { x: 0, y: 1, layer: "top" },
          { x: 10, y: 1, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "DATA",
        connectionNames: ["D0", "D1"],
        maxLengthSkew: 0.1,
      },
    ],
  }
}

test("reserves roundoff margin for a plain bus skew bound", () => {
  const input = plainBusInput()
  const reserved = withSkewRoundoffReserve(input)

  expect(reserved.buses?.[0]?.maxLengthSkew).toBeLessThan(0.1)
  expect(reserved.buses?.[0]?.maxLengthSkew).toBeCloseTo(0.099999, 12)
  expect(input.buses?.[0]?.maxLengthSkew).toBe(0.1)
})
