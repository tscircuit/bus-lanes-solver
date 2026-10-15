import { expect, test } from "bun:test"
import { offsetPath } from "../lib/coupled-pair-routing"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { reduceOrdinaryTurns } from "../lib/reduce-ordinary-turns"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { Point, SimpleRouteJson, Trace } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { connectors } from "../lib/vector-visibility"

test("paired shortening repairs separated offset defects progressively", () => {
  const width = 0.1,
    gap = 0.18,
    clearance = 0.1
  // Two independent 90-degree corner groups; a real hard rectangle prevents
  // any single analytic connector from bypassing both groups at once.
  const path: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 2 },
    { x: 7, y: 2 },
    { x: 7, y: 0 },
    { x: 8, y: 0 },
  ]
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: width,
    minTraceToPadEdgeClearance: clearance,
    bounds: { minX: -1, maxX: 9, minY: -2, maxY: 4 },
    connections: [
      {
        name: "pair_corridor",
        pointsToConnect: [path[0], path.at(-1)!].map((p) => ({
          ...p,
          layer: "top",
        })),
      },
    ],
    obstacles: [
      {
        center: { x: 4, y: 0 },
        width: 2,
        height: 2,
        layers: ["top"],
        connectedTo: ["HARD"],
      },
    ],
  }
  const scene = new VectorScene(
    input,
    input.connections[0],
    2 * width + gap,
    fixedCopper(input),
  )
  const pairedValid = (candidate: Point[]) => {
    try {
      const rails = [(width + gap) / 2, -(width + gap) / 2].map((offset) =>
        offsetPath(candidate, offset),
      )
      return (
        routeAnglesAreConventional(
          rails.map(
            (rail, i): Trace => ({
              type: "pcb_trace",
              pcb_trace_id: `rail_${i}`,
              route: rail.map((p) => ({
                ...p,
                route_type: "wire",
                layer: "top",
                width,
              })),
            }),
          ),
        ) &&
        rails.every((rail) => tuningPathIsSelfClear(rail, width + clearance))
      )
    } catch {
      return false
    }
  }
  expect(scene.pathVisible(path)).toBe(true)
  expect(pairedValid(path.slice(0, 4))).toBe(false)
  expect(pairedValid(path.slice(2))).toBe(false)
  for (const start of path.slice(0, 2))
    for (const end of path.slice(4))
      expect(connectors(start, end).every((p) => !scene.pathVisible(p))).toBe(
        true,
      )
  const before = structuredClone({ input, path })
  const result = reduceOrdinaryTurns(path, scene, pairedValid)
  // A whole-candidate-only gate cannot remove either region while the other
  // is still dirty. Transition-based protection allows both local repairs.
  expect(pairedValid(result)).toBe(true)
  expect(scene.pathVisible(result)).toBe(true)
  expect(result[0]).toBe(path[0])
  expect(result.at(-1)).toBe(path.at(-1))
  expect({ input, path }).toEqual(before)
})
