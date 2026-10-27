import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { SimpleRouteJson } from "../lib/types"

test("preserves a successful non-pad strategy and tries native carriers after real routing failure", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.11,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "DATA",
        pointsToConnect: [
          { x: -2.4, y: 0, layer: "top" },
          { x: 2.4, y: 0, layer: "top" },
        ],
      },
    ],
    obstacles: [],
  }
  for (const [componentId, x] of [
    ["U1", -2.4],
    ["U2", 2.4],
  ] as const)
    for (let index = 0; index < 4; index++)
      input.obstacles.push({
        type: "rect",
        shape: "circle",
        componentId,
        center: { x: x + (index % 2) * 0.8, y: Math.floor(index / 2) * 0.8 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: index === 0 ? ["DATA"] : [],
      })
  for (let index = 0; index < 9; index++)
    input.obstacles.push({
      type: "rect",
      shape: "circle",
      componentId: "U3",
      center: { x: -4 + index * 0.3, y: 4 },
      width: 0.1,
      height: 0.1,
      layers: ["top"],
      connectedTo: [],
    })
  const original = structuredClone(input)
  const preferred = new BusLanesPipelineSolver(input, {
    denseSearch: true,
    smoothTuning: false,
  })
  preferred.solve()
  expect(preferred.solved).toBe(true)
  expect(preferred.stats.carrierStrategy).toBe("preferred")
  expect(preferred.stats.carrierStrategyReason).toBeUndefined()
  expect(
    preferred.traces[0].route.some(
      (point) => point.route_type === "wire" && point.layer === "bottom",
    ),
  ).toBe(true)
  expect(
    preferred.traces[0].route.filter((point) => point.route_type === "via"),
  ).toHaveLength(2)

  const blocked = structuredClone(input)
  blocked.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 11,
    layers: ["bottom"],
    connectedTo: [],
  })
  const blockedOriginal = structuredClone(blocked)
  const fallback = new BusLanesPipelineSolver(blocked, {
    denseSearch: true,
    smoothTuning: false,
  })
  const aggregateBudget = fallback.MAX_ITERATIONS
  while (
    !fallback.solved &&
    !fallback.failed &&
    fallback.stats.carrierStrategy !== "native_fallback"
  )
    fallback.step()
  expect(fallback.phase).toBe("retry_native_carriers")
  expect(fallback.traces).toEqual([])
  expect(() => fallback.getOutput()).toThrow()
  fallback.solve()
  expect(fallback.solved).toBe(true)
  expect(fallback.failed).toBe(false)
  expect(fallback.stats.carrierStrategy).toBe("native_fallback")
  expect(fallback.stats.carrierStrategyReason).toBe("no_planar_route")
  expect(fallback.stats.carrierStrategyStartedAtIteration).toBeGreaterThan(0)
  expect(fallback.MAX_ITERATIONS).toBe(aggregateBudget)
  expect(fallback.iterations).toBeLessThan(aggregateBudget)
  expect(
    fallback.traces[0].route.every(
      (point) => point.route_type === "wire" && point.layer === "top",
    ),
  ).toBe(true)
  for (const [source, solver] of [
    [input, preferred],
    [blocked, fallback],
  ] as const)
    expect(
      validateRoutedCopperDrc({
        inputSrj: source,
        routedSrj: solver.getOutput(),
        clearance: 0.11,
        allowBlindAndBuriedVias: false,
      } as Parameters<typeof validateRoutedCopperDrc>[0]).issues,
    ).toEqual([])
  expect(input).toEqual(original)
  expect(blocked).toEqual(blockedOriginal)

  const exhausted = new BusLanesPipelineSolver(blocked, {
    denseSearch: true,
    smoothTuning: false,
    maxSearchIterations: 1,
  })
  exhausted.solve()
  expect(exhausted.solved).toBe(false)
  expect(exhausted.failed).toBe(true)
  expect(exhausted.MAX_ITERATIONS).toBe(2)
  expect(exhausted.stats.carrierStrategy).toBe("preferred")
  expect(exhausted.traces).toEqual([])
})
