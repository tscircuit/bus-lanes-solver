import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  BusLanesPipelineSolver,
  BusLanesSolver,
  busLengthReports,
  type SimpleRouteJson,
} from "../lib"
import {
  expectCompletedRouting,
  nativeValidationSrj,
} from "./fixtures/expect-completed-routing"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"

test("a completed data lane matches a strobe with an absolute length window", async () => {
  const board: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 12, minY: -4, maxY: 8 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    obstacles: [],
    connections: [
      {
        name: "DQ",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 8, y: 0, layer: "top" },
        ],
      },
      {
        name: "DQS",
        pointsToConnect: [
          { x: 0, y: 4, layer: "top" },
          { x: 10, y: 4, layer: "top" },
        ],
      },
    ],
  }
  const router = new BusLanesPipelineSolver(board, { fanout: "none" })
  router.solve()
  expectCompletedRouting(router, board)

  const input: SimpleRouteJson = {
    ...board,
    buses: [
      {
        busId: "strobe",
        connectionNames: ["DQS"],
        minLength: 11.96,
        maxLength: 12.04,
      },
      {
        busId: "data",
        connectionNames: ["DQ"],
        referenceConnectionNames: ["DQS"],
        skewReference: "references",
        maxLengthSkew: 0.02,
      },
    ],
  }
  const traces = router.traces
  const inputSrj = nativeValidationSrj(board)
  const routedSrj = nativeValidationSrj({ ...board, traces })
  expect(
    validateOriginalEndpointConnectivity({ inputSrj, routedSrj })
      .connectedConnectionCount,
  ).toBe(2)
  expect(
    validateRoutedCopperDrc({ inputSrj, routedSrj, clearance: 0.1 }).valid,
  ).toBe(true)
  const [strobe, data] = busLengthReports(input, traces)
  expect(strobe.aboveMinimumLength).toBe(false)
  expect(data.matched).toBe(false)
  const graphics = new BusLanesSolver({ ...board, traces }).visualize()
  graphics.texts = [
    {
      x: 0,
      y: 5,
      text: `DQS ${strobe.lengths[0].totalLengthMm!.toFixed(2)} mm (11.96–12.04 mm)`,
      fontSize: 0.36,
      anchorSide: "bottom_left",
    },
    {
      x: 0,
      y: -1,
      text: `DQ to DQS skew ${data.skewMm!.toFixed(3)} mm (limit 0.020 mm)`,
      fontSize: 0.36,
      anchorSide: "bottom_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
