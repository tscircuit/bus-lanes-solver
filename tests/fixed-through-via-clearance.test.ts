import "bun-match-svg"
import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  BusLanesPipelineSolver,
  BusLanesSolver,
  type SimpleRouteJson,
} from "../lib"
import {
  expectCompletedRouting,
  nativeValidationSrj,
} from "./fixtures/expect-completed-routing"

const clearance = 0.1
const clockConnection = {
  name: "CLK",
  pointsToConnect: [
    { x: 4, y: 1, layer: "inner1" },
    { x: 4, y: 3, layer: "bottom" },
  ],
}

const board: SimpleRouteJson = {
  bounds: { minX: -1, maxX: 9, minY: 0, maxY: 4 },
  layerCount: 4,
  minTraceWidth: 0.15,
  minTraceToPadEdgeClearance: clearance,
  obstacles: [],
  connections: [
    {
      name: "A3",
      pointsToConnect: [
        { x: 0, y: 2, layer: "top" },
        { x: 8, y: 2, layer: "top" },
      ],
    },
  ],
  buses: [
    { busId: "address", connectionNames: ["A3"], allowedLayers: ["top"] },
  ],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed_clock",
      connection_name: "CLK",
      route: [
        { route_type: "wire", x: 4, y: 1, layer: "inner1", width: 0.15 },
        { route_type: "wire", x: 4, y: 2, layer: "inner1", width: 0.15 },
        {
          route_type: "via",
          x: 4,
          y: 2,
          from_layer: "inner1",
          to_layer: "bottom",
          via_diameter: 0.45,
          via_hole_diameter: 0.2,
        },
        { route_type: "wire", x: 4, y: 2, layer: "bottom", width: 0.15 },
        { route_type: "wire", x: 4, y: 3, layer: "bottom", width: 0.15 },
      ],
    },
  ],
}

function routeAddressLane(input: SimpleRouteJson) {
  const solver = new BusLanesPipelineSolver(input, {
    fanout: "none",
    singleCarrier: { fixedConnections: [clockConnection] },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const connections = [...input.connections, clockConnection]
  const drc = validateRoutedCopperDrc({
    inputSrj: nativeValidationSrj({ ...input, connections }),
    routedSrj: nativeValidationSrj({ ...solver.getOutput(), connections }),
    clearance,
    allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
  })
  return { solver, drc }
}

test("a top-layer address lane clears the full barrel of a fixed clock via", async () => {
  const { solver, drc } = routeAddressLane(board)
  expect(drc.issues).toEqual([])
  expectCompletedRouting(solver, board)
  const graphics = new BusLanesSolver(solver.getOutput()).visualize()
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 640,
      svgHeight: 300,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})

test("a blind clock via leaves the top layer available for the address lane", () => {
  const input = { ...board, allowBlindAndBuriedVias: true }
  const { solver, drc } = routeAddressLane(input)
  expect(drc.issues).toEqual([])
  expectCompletedRouting(solver, input)
  const addressLane = solver
    .getOutput()
    .traces?.find((trace) => trace.connection_name === "A3")
  expect(addressLane?.route).toHaveLength(2)
})
