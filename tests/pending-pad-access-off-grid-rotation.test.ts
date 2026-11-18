import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import type { Point } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { validatePendingTerminalWitness } from "./fixtures/pending-access-certificates"
import { pendingOffGridQuarterTurn } from "./fixtures/pending-off-grid-quarter-turn"

function drain<T>(search: Generator<unknown, T>): T {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

function pointSegmentDistance({
  point,
  start,
  end,
}: {
  point: Point
  start: Point
  end: Point
}): number {
  const dx = end.x - start.x,
    dy = end.y - start.y
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  )
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy)
}

test("rotating the continuous access window cannot turn an unresolved baseline into preserved access", () => {
  const fixture = pendingOffGridQuarterTurn()
  const {
    input,
    future,
    control,
    candidate,
    witness,
    via,
    admissibleViaCenters: box,
  } = fixture
  const original = structuredClone(input)
  for (const [terminalIndex, terminal] of future.pointsToConnect.entries()) {
    const request = {
      input,
      traces: [],
      phaseIndex: 0,
      connection: future,
      terminalIndex,
      witness: { ...witness, path: [terminal, via] },
    }
    expect(validatePendingTerminalWitness(request).issues).toEqual([])
    expect(validatePendingTerminalWitness(request).valid).toBe(true)
    expect(
      validatePendingTerminalWitness({ ...request, traces: [candidate] }).valid,
    ).toBe(false)
  }
  expect(
    new VectorScene(input, control, 0.1, fixedCopper(input)).pathVisible(
      candidate.route,
    ),
  ).toBe(true)
  // Distance to a convex segment is convex, so the corner maximum bounds
  // every point of the continuous admissible-center rectangle.
  const cornerDistances = [
    { x: box.minX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
  ].map((point) =>
    pointSegmentDistance({
      point,
      start: candidate.route[0],
      end: candidate.route[1],
    }),
  )
  expect(Math.max(...cornerDistances)).toBeLessThan(
    fixture.landMm / 2 + 0.1 / 2 + 0.1,
  )
  let error: unknown
  try {
    drain(new PendingPadAccess(input).getPreservedReport([candidate]))
  } catch (caught) {
    error = caught
  }
  expect(error).toMatchObject({ code: "pending_access_search_unknown" })
  expect(input).toEqual(original)
})
