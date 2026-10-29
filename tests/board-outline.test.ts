import { expect, test } from "bun:test"
import { checkPcbTracesOutOfBoard } from "@tscircuit/checks"
import type { PcbBoard, PcbTrace } from "circuit-json"
import {
  BusLanesSolver,
  BusLanesPipelineSolver,
  type SimpleRouteJson,
  type Trace,
} from "../lib"
import {
  boardOutlineError,
  boardSegmentIsClear,
  traceStaysInsideOutline,
} from "../lib/board-outline"
import { VectorScene } from "../lib/vector-scene"
import { GridVisibilitySearch } from "../lib/grid-visibility"
import { joinedSignalGeometryIsValid } from "../lib/joined-signal-geometry"

function fixture(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -4, maxY: 4 },
    outline: [
      { x: -5, y: -4 },
      { x: 5, y: -4 },
      { x: 5, y: 4 },
      { x: 1, y: 4 },
      { x: 1, y: -1 },
      { x: -1, y: -1 },
      { x: -1, y: 4 },
      { x: -5, y: 4 },
    ],
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -3, y: 1, layer: "top" },
          { x: 3, y: 1, layer: "top" },
        ],
      },
    ],
  }
}

test("matches the autorouter board-edge DRC example with full trace width", () => {
  // Same geometry as tscircuit-autorouter/tests/drc-board-edge-debug.test.ts.
  const input = fixture()
  input.bounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 }
  input.outline = [
    { x: -4, y: -4 },
    { x: 4, y: -4 },
    { x: 4, y: 4 },
    { x: -4, y: 4 },
  ]
  const board: PcbBoard = {
    type: "pcb_board",
    pcb_board_id: "board",
    center: { x: 0, y: 0 },
    thickness: 1.6,
    num_layers: 2,
    material: "fr4",
    outline: input.outline,
    min_board_edge_clearance: input.minBoardEdgeClearance,
  }
  for (const [y, clear] of [
    [3.8, false],
    [3.69, true],
  ] as const) {
    const trace = {
      type: "pcb_trace",
      pcb_trace_id: "edge_trace",
      connection_name: "edge_trace",
      route: [
        { route_type: "wire", x: -1, y, width: 0.2, layer: "top" },
        { route_type: "wire", x: 1, y, width: 0.2, layer: "top" },
      ],
    } satisfies Trace & PcbTrace
    expect(traceStaysInsideOutline(input, trace)).toBe(clear)
    expect(checkPcbTracesOutOfBoard([board, trace]).length === 0).toBe(clear)
  }
})

test("outline checks reject concave shortcuts, outside points and copper too close to an edge", () => {
  const input = fixture()
  expect(
    boardSegmentIsClear(input, { x: -3, y: 1 }, { x: 3, y: 1 }, 0.05),
  ).toBe(false)
  expect(
    boardSegmentIsClear(input, { x: -3, y: -2 }, { x: 3, y: -2 }, 0.05),
  ).toBe(true)
  expect(
    boardSegmentIsClear(input, { x: -3, y: -1.1 }, { x: 3, y: -1.1 }, 0.05),
  ).toBe(false)
  expect(boardSegmentIsClear(input, { x: 0, y: 2 }, { x: 0, y: 2 }, 0.05)).toBe(
    false,
  )
  for (const outline of [
    input.outline!,
    input.outline!.toReversed(),
    [...input.outline!, input.outline![0]],
  ]) {
    expect(boardOutlineError(outline)).toBeUndefined()
    const scene = new VectorScene(
      { ...input, outline },
      input.connections[0],
      0.1,
      [],
    )
    expect(scene.visible({ x: -3, y: 1 }, { x: 3, y: 1 })).toBe(false)
    expect(scene.visible({ x: -3, y: -2 }, { x: 3, y: -2 })).toBe(true)
  }
})

for (const denseSearch of [false, true])
  test(`routes around a concave board cutout (${denseSearch ? "grid" : "vector"}) without changing the input`, () => {
    const input = fixture(),
      before = structuredClone(input)
    const solver = new BusLanesSolver(input, { denseSearch })
    solver.solve()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    expect(solver.traces).toHaveLength(1)
    expect(solver.traces[0].route.some((p) => p.y < -1.2)).toBe(true)
    expect(traceStaysInsideOutline(input, solver.traces[0])).toBe(true)
    expect(input).toEqual(before)
  })

test("the explicit rectangular outline control completes through the pipeline", () => {
  const input = fixture()
  input.outline = [
    { x: -5, y: -4 },
    { x: 5, y: -4 },
    { x: 5, y: 4 },
    { x: -5, y: 4 },
  ]
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(traceStaysInsideOutline(input, solver.traces[0])).toBe(true)
})

test("native grid access blocks off-board via lands and continuous notch crossings", () => {
  const input = fixture(),
    connection = input.connections[0]
  const scene = new VectorScene(input, connection, 0.3, [])
  const search = new GridVisibilitySearch(
    scene,
    connection.pointsToConnect[0],
    connection.pointsToConnect[1],
    [],
    0,
    undefined,
    { bounds: input.bounds, step: 0.1 },
  )
  const grid = search.getRoutingAccess()
  const at = (x: number, y: number) =>
    Math.round((y - input.bounds.minY) / 0.1) * grid.nx +
    Math.round((x - input.bounds.minX) / 0.1)
  expect(grid.isBlocked(at(0, 2))).toBe(true)
  expect(grid.isBlocked(at(-3, -1.3))).toBe(false)
  expect(grid.isBlocked(at(0, -1.3))).toBe(true)
  search.cancel()
})

test("final acceptance checks via diameter and the full pad-to-pad copper against the polygon", () => {
  const input = fixture()
  const trace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "invalid",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: -3, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: 3, y: 1, layer: "top", width: 0.1 },
    ],
  }
  expect(joinedSignalGeometryIsValid({ input, trace })).toBe(false)
  trace.route = [
    {
      route_type: "via",
      x: 0,
      y: -1.3,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.3,
    },
  ]
  expect(traceStaysInsideOutline(input, trace)).toBe(false)
})

for (const outline of [
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ],
  [
    { x: 0, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
    { x: 2, y: 0 },
  ],
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: NaN, y: 1 },
  ],
])
  test("invalid outlines fail before searching", () => {
    const input = { ...fixture(), outline }
    for (const solver of [
      new BusLanesSolver(input),
      new BusLanesPipelineSolver(input),
    ]) {
      solver.solve()
      expect(solver.solved).toBe(false)
      expect(solver.failureCode).toBe("invalid_outline")
      expect(() => solver.getOutput()).toThrow()
    }
  })
