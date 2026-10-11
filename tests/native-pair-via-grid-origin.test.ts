import { expect, spyOn, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import {
  NativeCarrierRouter,
  type NativeCarrierSearchOptions,
} from "../lib/native-carrier-router"
import { planNativePairedCarriers } from "../lib/plan-native-paired-carriers"
import type { Connection, Point, SimpleRouteJson } from "../lib/types"

test("pair balancing proposes off-grid vias when native bounds have a fractional origin", () => {
  const step = 0.1
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: step,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -4.03, maxX: 4.07, minY: -2.03, maxY: 2.07 },
    connections: ["P", "N"].map((name, i) => ({
      name,
      pointsToConnect: [-3, 3].map((x) => ({
        x,
        y: i ? -0.4 : 0.4,
        layer: "top",
      })),
    })),
    obstacles: ["P", "N"].flatMap((name, i) =>
      [-3, 3].map((x, side) => ({
        type: "rect",
        shape: "circle" as const,
        componentId: `package_${side}`,
        center: { x, y: i ? -0.4 : 0.4 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: [name],
      })),
    ),
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.1, lengthTolerance: 0.1 },
    ],
  }
  const before = structuredClone(input),
    stopped = new Error("Captured balancing before residual matching"),
    originalRoute = NativeCarrierRouter.prototype.route
  const attempts: Array<{ point: Point; accepted: boolean }> = []
  let first:
    | {
        router: NativeCarrierRouter
        connection: Connection
        options: NativeCarrierSearchOptions
      }
    | undefined
  const routing = spyOn(
    NativeCarrierRouter.prototype,
    "route",
  ).mockImplementation(function* (
    this: NativeCarrierRouter,
    connection,
    options = {},
  ) {
    const result = yield* originalRoute.call(this, connection, options)
    if (options.forcedVia) {
      first ??= { router: this, connection, options }
      attempts.push({ point: options.forcedVia, accepted: result !== null })
    }
    return result
  })
  const matching = spyOn(BusLanesSolver, "forRefinement").mockImplementation(
    () => {
      throw stopped
    },
  )
  try {
    const search = planNativePairedCarriers(input, {
      centerlines: [
        [
          { x: -2.8, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
          { x: 2.8, y: 0 },
        ],
      ],
      gridStep: step,
      maxApproachPasses: 20,
      maxExpansionsPerRoute: 10000,
    })
    expect(() => {
      let result = search.next()
      while (!result.done) result = search.next()
    }).toThrow(stopped)
  } finally {
    routing.mockRestore()
    matching.mockRestore()
  }
  expect(attempts.length).toBeGreaterThan(0)
  const onNativeGrid = (point: Point) =>
    [
      (point.x - input.bounds.minX) / step,
      (point.y - input.bounds.minY) / step,
    ].every(
      (coordinate) => Math.abs(coordinate - Math.round(coordinate)) < 1e-8,
    )
  expect(attempts.every(({ point }) => !onNativeGrid(point))).toBe(true)
  expect(attempts.some(({ accepted }) => accepted)).toBe(false)
  // Prove this scene has a legal alternative: project those same sites onto
  // the router's actual grid and run the unchanged physical router again.
  const legal = attempts.some(({ point }) => {
    const forcedVia = {
      x:
        input.bounds.minX +
        Math.round((point.x - input.bounds.minX) / step) * step,
      y:
        input.bounds.minY +
        Math.round((point.y - input.bounds.minY) / step) * step,
    }
    const search = originalRoute.call(first!.router, first!.connection, {
      ...first!.options,
      forcedVia,
    })
    let result = search.next()
    while (!result.done) result = search.next()
    return result.value !== null
  })
  expect(legal).toBe(true)
  expect(input).toEqual(before)
})
