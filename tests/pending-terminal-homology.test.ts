import { expect, test } from "bun:test"
import {
  applyToPoint,
  compose,
  type Matrix,
  rotateDEG,
  scale,
  translate,
} from "transformation-matrix"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingTerminalHomology } from "../lib/pending-terminal-homology"
import type { Point, Terminal, Trace } from "../lib/types"
import { fixedCopper } from "../lib/vector-scene"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

function homologyFor(terminals: Terminal[], layerCount = 2) {
  const { input, pendingConnection } = pendingPadAccessFixture()
  input.layerCount = layerCount
  pendingConnection.pointsToConnect = terminals
  return new PendingTerminalHomology(input)
}

function along({
  homology,
  path,
  layer = "top",
  initial = homology.empty,
}: {
  homology: PendingTerminalHomology
  path: Point[]
  layer?: string
  initial?: number
}): number {
  let signature = initial
  for (let index = 1; index < path.length; index++) {
    signature = homology.extend({
      signature,
      layer,
      start: path[index - 1],
      end: path[index],
    })
  }
  return signature
}

function around(point: Point): Point[] {
  return [
    { x: point.x - 0.4, y: point.y - 0.4 },
    { x: point.x + 0.4, y: point.y - 0.4 },
    { x: point.x + 0.4, y: point.y + 0.4 },
    { x: point.x - 0.4, y: point.y + 0.4 },
    { x: point.x - 0.4, y: point.y - 0.4 },
  ]
}

test("ray crossings use a half-open vertex rule and retain integer winding", () => {
  const homology = homologyFor([{ x: 0, y: 0, layer: "top" }])
  const start = { x: 1, y: -1 }
  const vertex = { x: 1, y: 0 }
  const end = { x: 1, y: 1 }
  const crossing = along({ homology: homology, path: [start, end] })
  const split = along({ homology: homology, path: [start, vertex, end] })

  expect(crossing).not.toBe(homology.empty)
  expect(split).toBe(crossing)
  expect(
    along({
      homology: homology,
      path: [end, vertex, start],
      layer: "top",
      initial: split,
    }),
  ).toBe(homology.empty)
  const twice = along({
    homology: homology,
    path: [start, end],
    layer: "top",
    initial: crossing,
  })
  expect(twice).not.toBe(crossing)
  expect(twice).not.toBe(homology.empty)
  expect(
    along({
      homology: homology,
      path: [end, start],
      layer: "top",
      initial: twice,
    }),
  ).toBe(crossing)
})

test("tangencies and horizontal collinear ray segments do not double count", () => {
  const homology = homologyFor([{ x: 0, y: 0, layer: "top" }])
  expect(
    along({
      homology: homology,
      path: [
        { x: 1, y: -1 },
        { x: 1, y: 0 },
        { x: 2, y: -1 },
      ],
    }),
  ).toBe(homology.empty)
  expect(
    along({
      homology: homology,
      path: [
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 2, y: 1 },
      ],
    }),
  ).toBe(homology.empty)
  expect(
    along({
      homology: homology,
      path: [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 0 },
      ],
    }),
  ).toBe(homology.empty)
  expect(
    along({
      homology: homology,
      path: [
        { x: 1, y: -1 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
      ],
    }),
  ).toBe(
    along({
      homology: homology,
      path: [
        { x: 1, y: -1 },
        { x: 1, y: 1 },
      ],
    }),
  )
})

test("same-endpoint path class relationships survive translation, rotation and reflection", () => {
  const terminals = [
    { x: 0, y: 0, layer: "top" },
    { x: 3, y: 3, layer: "top" },
  ]
  const above = [
    { x: -1, y: -1 },
    { x: -1, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: -1 },
  ]
  const fartherAbove = [
    { x: -1, y: -1 },
    { x: -2, y: -1 },
    { x: -2, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: -1 },
    { x: 1, y: -1 },
  ]
  const below = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
  ]
  const transforms: Matrix[] = [
    translate(0, 0),
    translate(17.2, -9.4),
    rotateDEG(45),
    rotateDEG(90),
    compose(translate(-7.3, 12.6), rotateDEG(37)),
    scale(-1, 1),
    compose(translate(4.5, -2.7), rotateDEG(23), scale(-1, 1)),
  ]

  for (const transform of transforms) {
    const homology = homologyFor(
      terminals.map((point) => ({
        ...point,
        ...applyToPoint(transform, point),
      })),
    )
    const transformed = [above, fartherAbove, below].map((path) =>
      path.map((point) => applyToPoint(transform, point)),
    )
    expect(along({ homology: homology, path: transformed[0] })).toBe(
      along({ homology: homology, path: transformed[1] }),
    )
    expect(along({ homology: homology, path: transformed[0] })).not.toBe(
      along({ homology: homology, path: transformed[2] }),
    )
  }
})

test("every native layer of each future terminal contributes independently", () => {
  const homology = homologyFor(
    [
      { x: 0, y: 0, layer: "top" },
      { x: 4, y: 0, layer: "bottom" },
      { x: 8, y: 0, layer: "top", layers: ["top", "bottom"] },
      { x: 12, y: 0, layer: "inner1" },
    ],
    4,
  )

  expect(
    along({ homology: homology, path: around({ x: 0, y: 0 }), layer: "top" }),
  ).not.toBe(homology.empty)
  expect(
    along({
      homology: homology,
      path: around({ x: 0, y: 0 }),
      layer: "bottom",
    }),
  ).toBe(homology.empty)
  expect(
    along({
      homology: homology,
      path: around({ x: 4, y: 0 }),
      layer: "bottom",
    }),
  ).not.toBe(homology.empty)
  expect(
    along({ homology: homology, path: around({ x: 4, y: 0 }), layer: "top" }),
  ).toBe(homology.empty)
  const flexibleTop = along({
    homology: homology,
    path: around({ x: 8, y: 0 }),
    layer: "top",
  })
  const flexibleBottom = along({
    homology: homology,
    path: around({ x: 8, y: 0 }),
    layer: "bottom",
  })
  expect(flexibleTop).not.toBe(homology.empty)
  expect(flexibleBottom).not.toBe(homology.empty)
  expect(flexibleTop).not.toBe(flexibleBottom)
  expect(
    along({
      homology: homology,
      path: around({ x: 8, y: 0 }),
      layer: "inner1",
    }),
  ).toBe(homology.empty)
  expect(
    along({
      homology: homology,
      path: around({ x: 12, y: 0 }),
      layer: "inner1",
    }),
  ).not.toBe(homology.empty)
})

test("multiterminal intent tracks every terminal beyond eight points", () => {
  const terminals = Array.from({ length: 12 }, (_, index) => ({
    x: index * 3,
    y: 0,
    layer: "top",
  }))
  const homology = homologyFor(terminals)
  const signatures = terminals.map((point) =>
    along({ homology: homology, path: around(point) }),
  )

  for (const signature of signatures) expect(signature).not.toBe(homology.empty)
  expect(new Set(signatures).size).toBe(terminals.length)
})

test("without future intent every edge leaves the empty state unchanged", () => {
  const { input, pendingConnection } = pendingPadAccessFixture()
  input.pendingRoutingAccess = undefined
  input.connections = [pendingConnection]
  input.layerCount = 4
  const homology = new PendingTerminalHomology(input)

  for (const layer of ["top", "inner1", "inner2", "bottom"]) {
    expect(
      along({ homology: homology, path: around({ x: 0, y: 0 }), layer: layer }),
    ).toBe(homology.empty)
  }
})

test("equal homology enriches the candidate domain but physical access still decides", () => {
  const { input, upperLeft, lowerRight } = pendingPadAccessFixture()
  const far: Trace = {
    ...lowerRight,
    route: [
      { x: 0.7, y: 0.54 },
      { x: 2.5, y: 0.54 },
      { x: 2.5, y: -2.5 },
      { x: -0.54, y: -2.5 },
      { x: -0.54, y: -0.7 },
    ].map((point) => ({
      ...point,
      route_type: "wire",
      layer: "top",
      width: 0.1,
    })),
  }
  const homology = new PendingTerminalHomology(input)
  expect(along({ homology: homology, path: lowerRight.route })).toBe(
    along({ homology: homology, path: far.route }),
  )

  const copper = [upperLeft, lowerRight, far].map((trace) =>
    fixedCopper({
      ...input,
      obstacles: [],
      traces: [trace],
    }),
  )
  const conflict = new CopperConflictIndex()
  const supplied = fixedCopper(input)
  for (const index of [1, 2]) {
    expect(
      conflict.firstConflict(copper[0], copper[index], 0.1 - 1e-8),
    ).toBeUndefined()
    expect(
      conflict.firstConflict(copper[index], supplied, 0.1 - 1e-8),
    ).toBeUndefined()
  }
  // Both paths go around the same side of every future terminal. Only the
  // larger pocket contains an accessible legal via outside the bottom copper.
  expect(
    blockedPendingConnections(new PendingPadAccess(input), [
      upperLeft,
      lowerRight,
    ]).map((connection) => connection.name),
  ).toEqual(["DDR_STROBE"])
  expect(
    blockedPendingConnections(new PendingPadAccess(input), [upperLeft, far]),
  ).toEqual([])
})
