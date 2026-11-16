import { expect, test } from "bun:test"
import { SingleLayerConnectivitySolver } from "../lib/single-layer-connectivity-solver"
import { connectivityDrillConflicts } from "../lib/connectivity-geometry"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { SimpleRouteJson } from "../lib/types"

function crossedPads(offset = 0): SimpleRouteJson {
  const permutation = [0, 2, 9, 5, 4, 7, 8, 1, 6, 3]
  const connections = permutation.map((p, i) => ({
    name: "net-" + i,
    pointsToConnect: [
      {
        x: offset - 1.5 + (i % 2) * 0.5,
        y: Math.floor(i / 2) * 0.5,
        layer: "top",
        pcb_port_id: "left-" + i,
      },
      {
        x: offset + 1.5 + (p % 2) * 0.5,
        y: Math.floor(p / 2) * 0.5,
        layer: "top",
        pcb_port_id: "right-" + i,
      },
    ],
  }))
  return {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: 0.09,
    minTraceToPadEdgeClearance: 0.09,
    minViaPadDiameter: 0.25,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.25,
    bounds: { minX: offset - 3, maxX: offset + 4, minY: -2, maxY: 3 },
    connections,
    obstacles: connections.flatMap((c) =>
      c.pointsToConnect.map((p, j) => ({
        shape: "circle",
        componentId: "package-" + j,
        center: { x: p.x, y: p.y },
        width: 0.23,
        height: 0.23,
        layers: ["top"],
        connectedTo: [c.name, p.pcb_port_id],
      })),
    ),
  }
}
test("bounded refinement repairs a synthetic crossed pad bank without changing its input", () => {
  for (const offset of [0, 8]) {
    const input = crossedPads(offset),
      before = structuredClone(input)
    const options = {
      gridStep: 0.3,
      maxPasses: 2,
      maxExpansionsPerRoute: 100000,
    }
    const coarse = new SingleLayerConnectivitySolver(input, {
      ...options,
      maxRefinements: 0,
    })
    coarse.solve()
    expect(coarse.solved).toBe(false)
    expect(coarse.traces).toEqual([])
    const refined = new SingleLayerConnectivitySolver(input, {
      ...options,
      maxRefinements: 2,
    })
    refined.solve()
    expect(refined.error).toBeNull()
    expect(refined.solved).toBe(true)
    expect(refined.traces).toHaveLength(10)
    expect(refined.stats.refinedSignals).toBeGreaterThan(0)
    expect(input).toEqual(before)
    expect(connectivityDrillConflicts(input, refined.traces)).toEqual([])
    const drc = validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: refined.getOutput(),
      clearance: 0.09,
      allowBlindAndBuriedVias: false,
    } as any)
    expect(drc.valid).toBe(true)
  }
}, 30000)
test("refinement budgets and drill clearances reject invalid values", () => {
  for (const maxRefinements of [-1, 0.5, 5, Infinity])
    expect(
      () =>
        new SingleLayerConnectivitySolver(crossedPads(), { maxRefinements }),
    ).toThrow("maxRefinements")
  for (const value of [-1, NaN, Infinity])
    expect(
      () =>
        new SingleLayerConnectivitySolver({
          ...crossedPads(),
          minViaHoleEdgeToViaHoleEdgeClearance: value,
        }),
    ).toThrow("Via hole clearance")
})
