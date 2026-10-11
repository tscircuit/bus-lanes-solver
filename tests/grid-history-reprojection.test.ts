import { expect, test } from "bun:test"
import { GridHistoryProjector } from "../lib/grid-visibility"
import { VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson } from "../lib/types"

test("congestion reprojection follows physical coordinates across resolutions and bounds", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -0.5, y: 0, layer: "top" },
          { x: 0.5, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const scene = new VectorScene(input, input.connections[0], 0.1, [])
  const coarse = new GridHistoryProjector(scene, {
    bounds: input.bounds,
    step: 0.2,
  })
  const history = new Float32Array(coarse.cellCount)
  history[5 + 5 * 11] = 7
  history[4 + 5 * 11] = 3
  const before = history.slice()
  const fine = new GridHistoryProjector(scene, {
    bounds: { minX: -0.7, maxX: 0.9, minY: -0.5, maxY: 0.7 },
    step: 0.1,
  })
  const projected = fine.reprojectHistory(coarse, history)
  expect(projected[7 + 5 * 17]).toBe(7)
  expect(projected[5 + 5 * 17]).toBe(3)
  expect(projected[7 + 2 * 17]).toBe(0)
  expect(coarse.reprojectHistory(coarse, history)).toEqual(history)
  const wide = new GridHistoryProjector(scene, {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    step: 0.1,
  })
  const widened = wide.reprojectHistory(coarse, history)
  expect(widened[20 + 20 * 41]).toBe(7)
  expect(widened[0 + 20 * 41]).toBe(0)
  expect(widened[20 + 0 * 41]).toBe(0)
  projected.fill(99)
  expect(history).toEqual(before)
  expect(() => fine.reprojectHistory(coarse, new Float32Array(1))).toThrow(
    "does not match its source grid",
  )
})
