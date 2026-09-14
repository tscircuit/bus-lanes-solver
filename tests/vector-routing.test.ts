import { expect, test } from "bun:test"
import { BusLanesSolver, type SimpleRouteJson } from "../lib"
import { segmentDistance } from "../lib/geometry"

import { channelInput } from "../examples/vector-channel"
test("vector obstacle detours are octilinear, continuous and translation invariant", () => {
  const results = [0, 0.013719].map((offset) => {
    const s = new BusLanesSolver(channelInput(offset))
    s.solve()
    expect(s.solved).toBe(true)
    return s.traces.map((t) =>
      t.route.map((p) => ({ x: p.x - offset, y: p.y - offset })),
    )
  })
  expect(results[0].length).toBe(3)
  results[0].forEach((route, i) => {
    expect(route.length).toBe(results[1][i].length)
    route.forEach((p, j) => {
      expect(p.x).toBeCloseTo(results[1][i][j].x, 7)
      expect(p.y).toBeCloseTo(results[1][i][j].y, 7)
      if (j) {
        const q = route[j - 1],
          dx = Math.abs(p.x - q.x),
          dy = Math.abs(p.y - q.y)
        expect(Math.min(dx, dy) < 1e-8 || Math.abs(dx - dy) < 1e-8).toBe(true)
      }
    })
  })
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 3; b++)
      for (let i = 1; i < results[0][a].length; i++)
        for (let j = 1; j < results[0][b].length; j++)
          expect(
            segmentDistance(
              [results[0][a][i - 1], results[0][a][i]],
              [results[0][b][j - 1], results[0][b][j]],
            ),
          ).toBeGreaterThanOrEqual(0.079999)
})
test("finds an off-lattice narrow opening using obstacle vertices", () => {
  const j = channelInput(0.013719)
  j.connections = j.connections.slice(0, 1)
  j.connections[0].pointsToConnect = [
    { x: 0, y: 0, layer: "top" },
    { x: 10, y: 0, layer: "top" },
  ]
  j.obstacles = [
    {
      center: { x: 5, y: 1.082913 },
      width: 1,
      height: 2,
      layers: ["top"],
      connectedTo: [],
    },
    {
      center: { x: 5, y: -1.047087 },
      width: 1,
      height: 2,
      layers: ["top"],
      connectedTo: [],
    },
  ]
  const s = new BusLanesSolver(j)
  s.solve()
  expect(s.solved).toBe(true)
  expect(Math.max(...s.traces[0].route.map((p) => Math.abs(p.y)))).toBeLessThan(
    0.04,
  )
})
