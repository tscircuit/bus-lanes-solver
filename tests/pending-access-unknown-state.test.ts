import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingAccessSearchUnknownError } from "../lib/pending-access-search-unknown"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { Trace } from "../lib/types"
import { pendingOffGridWindow } from "./fixtures/pending-off-grid-window"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

function finish<T>(search: Generator<void, T>): T {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

test("an unchanged relational query cannot poison strict original or changed final evidence", () => {
  const { input, candidate } = pendingOffGridWindow(0.1)
  const access = new PendingPadAccess(input)
  expect(finish(access.getBlockedConnections([]))).toEqual([])
  expect(() => finish(access.getPreservedReport([]))).toThrow(
    PendingAccessSearchUnknownError,
  )
  expect(() => finish(access.getPreservedReport([candidate]))).toThrow(
    PendingAccessSearchUnknownError,
  )
  expect(finish(access.getBlockedConnections([]))).toEqual([])
  expect(() => finish(access.getPreservedReport([]))).toThrow(
    PendingAccessSearchUnknownError,
  )
})

test("a positive owned after certificate can resolve a candidate without rewriting its unknown original", () => {
  const { input, control, future, via } = pendingOffGridWindow(0.1)
  control.name = future.name
  control.pointsToConnect = [
    future.pointsToConnect[0],
    { x: via.x + 0.05, y: via.y, layer: "bottom" },
  ]
  const owned: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "current_owned_via",
    connection_name: control.name,
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: via.y, y: via.y, layer: "top", width: 0.1 },
      { route_type: "wire", ...via, layer: "top", width: 0.1 },
      {
        route_type: "via",
        ...via,
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "bottom"],
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { route_type: "wire", ...via, layer: "bottom", width: 0.1 },
      {
        route_type: "wire",
        x: via.x + 0.05,
        y: via.y,
        layer: "bottom",
        width: 0.1,
      },
    ],
  }
  const original = structuredClone(input)
  const obstacles = input.obstacles.map((obstacle) => {
    if (obstacle.type !== "rect")
      throw Error("Use the original rectangular fixture obstacles")
    return { ...obstacle, type: "rect" as const }
  })
  const drcInput = { ...input, obstacles, traces: [] }
  const drc = validateRoutedCopperDrc({
    inputSrj: drcInput,
    routedSrj: {
      ...drcInput,
      traces: [{ ...owned, connection_name: control.name }],
    },
    clearance: 0.1,
  })
  expect(drc.issues).toEqual([])
  expect(drc.valid).toBe(true)
  const access = new PendingPadAccess(input)
  expect(finish(access.getBlockedConnections([]))).toEqual([])
  expect(() => finish(access.getPreservedReport([]))).toThrow(
    PendingAccessSearchUnknownError,
  )
  const after = finish(access.getPreservedReport([owned]))!
  expect(after.outcome).toBe("preserved")
  expect(after.baselineAccessibleFramedTerminalCount).toBe(0)
  expect(after.baselineInaccessibleFramedTerminalCount).toBe(0)
  expect(after.baselineUnresolvedFramedTerminalCount).toBe(2)
  // A prior candidate's manufactured via is not present in the original union.
  expect(() => finish(access.getPreservedReport([]))).toThrow(
    PendingAccessSearchUnknownError,
  )
  expect(input).toEqual(original)
})

test("finite after misses remain unknown with a positive original and never cache a negative proof", () => {
  const { input, upperLeft, lowerRight, pendingConnection } =
    pendingPadAccessFixture()
  const access = new PendingPadAccess(input)
  expect(
    finish(access.getPreservedReport([]))!
      .baselineAccessibleFramedTerminalCount,
  ).toBe(2)
  const before = access.unknownCount
  expect(
    finish(access.getUncertifiedConnections([upperLeft, lowerRight])),
  ).toEqual([pendingConnection])
  expect(access.unknownCount).toBeGreaterThan(before)
  const previous = access.unknownCount
  expect(
    finish(access.getUncertifiedConnections([upperLeft, lowerRight])),
  ).toEqual([pendingConnection])
  expect(access.unknownCount).toBeGreaterThan(previous)
  expect(() =>
    finish(access.getBlockedConnections([upperLeft, lowerRight])),
  ).toThrow(PendingAccessSearchUnknownError)
  expect(() => access.noSolution()).toThrow(PendingAccessSearchUnknownError)
})
