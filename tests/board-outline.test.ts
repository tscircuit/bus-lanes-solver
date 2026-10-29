import { boardOutlineInput } from "./fixtures/board-outline"
import { expect, test } from "bun:test"
import { checkPcbTracesOutOfBoard } from "@tscircuit/checks"
import type { PcbBoard, PcbTrace } from "circuit-json"
import { BusLanesSolver, BusLanesPipelineSolver, type Trace } from "../lib"
import {
  boardOutlineError,
  boardSegmentIsClear,
  traceStaysInsideOutline,
} from "../lib/board-outline"
import { VectorScene } from "../lib/vector-scene"
import { GridVisibilitySearch } from "../lib/grid-visibility"
import { joinedSignalGeometryIsValid } from "../lib/joined-signal-geometry"

test("matches the autorouter board-edge DRC example with full trace width", () => {
  // Same geometry as tscircuit-autorouter/tests/drc-board-edge-debug.test.ts.
  const input = boardOutlineInput()
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
  const input = boardOutlineInput()
  expect(
    boardSegmentIsClear({
      input: input,
      start: { x: -3, y: 1 },
      end: { x: 3, y: 1 },
      copperRadiusMm: 0.05,
    }),
  ).toBe(false)
  expect(
    boardSegmentIsClear({
      input: input,
      start: { x: -3, y: -2 },
      end: { x: 3, y: -2 },
      copperRadiusMm: 0.05,
    }),
  ).toBe(true)
  expect(
    boardSegmentIsClear({
      input: input,
      start: { x: -3, y: -1.1 },
      end: { x: 3, y: -1.1 },
      copperRadiusMm: 0.05,
    }),
  ).toBe(false)
  expect(
    boardSegmentIsClear({
      input: input,
      start: { x: 0, y: 2 },
      end: { x: 0, y: 2 },
      copperRadiusMm: 0.05,
    }),
  ).toBe(false)
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
    const input = boardOutlineInput(),
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
  const input = boardOutlineInput()
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
  const input = boardOutlineInput(),
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
  const input = boardOutlineInput()
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
    const input = { ...boardOutlineInput(), outline }
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

for (const reverse of [false, true]) {
  for (const close of [false, true]) {
    test(`concave routing preserves endpoints for ${reverse ? "clockwise" : "counterclockwise"} ${close ? "closed" : "open"} outlines`, () => {
      const input = boardOutlineInput()
      if (reverse) input.outline = input.outline!.toReversed()
      if (close) input.outline = [...input.outline!, input.outline![0]]
      const before = structuredClone(input)
      const solver = new BusLanesSolver(input)
      solver.solve()
      expect(solver.solved).toBe(true)
      const route = solver.traces[0].route
      const [start, end] = input.connections[0].pointsToConnect
      expect({ x: route[0].x, y: route[0].y }).toEqual({
        x: start.x,
        y: start.y,
      })
      expect({ x: route.at(-1)!.x, y: route.at(-1)!.y }).toEqual({
        x: end.x,
        y: end.y,
      })
      expect(traceStaysInsideOutline(input, solver.traces[0])).toBe(true)
      expect(input).toEqual(before)
    })
  }
}

test("via-land clearance uses the full diameter rather than the drill", () => {
  const input = boardOutlineInput()
  const via: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "via_land",
    route: [
      {
        route_type: "via",
        x: 0,
        y: -1.5,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.1,
      },
    ],
  }
  expect(traceStaysInsideOutline(input, via)).toBe(true)
  via.route = [
    {
      ...via.route[0],
      route_type: "via",
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.8,
      via_hole_diameter: 0.1,
    },
  ]
  expect(traceStaysInsideOutline(input, via)).toBe(false)
})

test("a nonzero-area self-intersection and repeated degenerate vertices are rejected", () => {
  expect(
    boardOutlineError([
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 4 },
      { x: 4, y: 0 },
    ]),
  ).toContain("simple polygon")
  expect(
    boardOutlineError([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]),
  ).toContain("three vertices")
})
