import { expect, test } from "bun:test"
import { findPendingPadEscape } from "../lib/pending-pad-escape"
import type { Obstacle } from "../lib/types"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

test("a future trace-to-NPTH rule can close exits that clear the ordinary pad margin", () => {
  const { input, pendingConnection } = pendingPadAccessFixture()
  const holes: Obstacle[] = [
    { x: -0.7, y: -0.7 },
    { x: -0.7, y: 0.7 },
    { x: 0.7, y: -0.7 },
    { x: 0.7, y: 0.7 },
  ].map((point) => ({
    type: "rect",
    shape: "circle",
    isNonPlatedHole: true,
    center: point,
    width: 0.1,
    height: 0.1,
    layers: ["top", "bottom"],
    connectedTo: [],
  }))
  input.obstacles.push(...holes)
  const strict = structuredClone(input)
  strict.pendingRoutingAccess![0].minTraceToHoleEdgeClearance = 0.65

  function escape(input: typeof strict) {
    const search = findPendingPadEscape({
      input: { ...input, ...input.pendingRoutingAccess![0] },
      connection: pendingConnection,
      terminalIndex: 0,
    })
    let step = search.next()
    while (!step.done) step = search.next()
    return step.value
  }
  expect(escape(input)).not.toBeNull()
  expect(escape(strict)).toBeNull()
})
