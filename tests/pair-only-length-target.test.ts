import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"

function pairOnlyInput(): SimpleRouteJson {
  const connections = ["P", "N"].map((name, i) => ({
    name,
    pointsToConnect: [
      { x: -6, y: -0.5 + i, layer: "top" },
      { x: 6, y: -0.5 + i, layer: "top" },
    ],
  }))
  return {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minBoardEdgeClearance: 0.2,
    allowViaInPad: false,
    bounds: { minX: -8, maxX: 8, minY: -2, maxY: 2 },
    connections,
    obstacles: connections.flatMap((c) =>
      c.pointsToConnect.map((p, i) => ({
        type: "rect",
        shape: "circle" as const,
        componentId: `package_${i}`,
        center: { x: p.x, y: p.y },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: [c.name],
      })),
    ),
    differentialPairs: [
      { connectionNames: ["P", "N"], lengthTolerance: 0.1, traceGap: 0.1 },
    ],
    buses: [{ busId: "DQS", connectionNames: ["P", "N"], maxLengthSkew: 0.1 }],
  }
}

test("a pair-only bus routes without artificial tuning headroom", () => {
  const input = pairOnlyInput(),
    before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(2)
  expect(busLengthReports(input, solver.traces).every((r) => r.matched)).toBe(
    true,
  )
  expect(pairLengthReports(input, solver.traces).every((r) => r.matched)).toBe(
    true,
  )
  expect(
    exteriorPairSpacingReports(input, solver.traces).every((r) => r.matched),
  ).toBe(true)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: solver.getOutput(),
      clearance: 0.1,
    } as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  expect(input).toEqual(before)
}, 30000)
