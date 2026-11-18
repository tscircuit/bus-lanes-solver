import { expect, test } from "bun:test"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingAccessSearchUnknownError } from "../lib/pending-access-search-unknown"
import type { Trace } from "../lib/types"
import { fixedCopper } from "../lib/vector-scene"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"
import { pendingOwnedRecoveryFixture } from "./fixtures/pending-owned-recovery"

function finish<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

test("recovering an unresolved original does not erase its certificate requirement or rebase its status", () => {
  const { input, frozen, owned, pendingConnection } =
    pendingOwnedRecoveryFixture("name")
  input.traces = frozen
  const future = input.pendingRoutingAccess![0]
  future.allowedLayers = ["bottom"]
  future.buses = [
    {
      busId: "wide_future",
      connectionNames: [pendingConnection.name],
      traceWidth: 1,
    },
  ]
  // The old 0.1 mm wire and 0.4 mm vias stay legal inside this 0.8 mm
  // corridor. A new 1 mm continuation cannot contact their bottom copper.
  const start = { x: 0.5, y: 0.5 }
  const end = { x: -3.5, y: -3.5 }
  const direction = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }
  const normal = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }
  const corners = [
    { anchor: start, along: -0.4, across: 0.4 },
    { anchor: end, along: 0.4, across: 0.4 },
    { anchor: end, along: 0.4, across: -0.4 },
    { anchor: start, along: -0.4, across: -0.4 },
  ].map(({ anchor, along, across }) => ({
    x: anchor.x + direction.x * along + normal.x * across,
    y: anchor.y + direction.y * along + normal.y * across,
  }))
  const foreign: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "foreign_bottom_corridor",
    connection_name: "FOREIGN_BOTTOM",
    route: [...corners, corners[0]].map((point) => ({
      ...point,
      route_type: "wire",
      layer: "bottom",
      width: 0.1,
    })),
  }
  const original = structuredClone(input)
  const foreignCopper = fixedCopper({
    ...input,
    obstacles: [],
    traces: [foreign],
  })
  const priorCopper = fixedCopper({ ...input, traces: [...frozen, owned] })
  expect(
    new CopperConflictIndex().firstConflict(
      foreignCopper,
      priorCopper,
      0.1 - 1e-8,
    ),
  ).toBeUndefined()

  const originalAccess = new PendingPadAccess(input)
  expect(blockedPendingConnections(originalAccess, [])).toEqual([])
  expect(() => finish(originalAccess.getPreservedReport([]))).toThrow(
    PendingAccessSearchUnknownError,
  )

  // This deliberately rebased oracle is the counterfactual. The production
  // search must continue using originalAccess, not initialize this new baseline.
  const rebased = new PendingPadAccess({ ...input, traces: [...frozen, owned] })
  const recoveredReport = finish(rebased.getPreservedReport([]))!
  expect(recoveredReport.baselineAccessibleFramedTerminalCount).toBe(2)
  expect(
    blockedPendingConnections(rebased, [foreign]).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])

  const after = finish(originalAccess.getPreservedReport([owned]))!
  expect(after.baselineAccessibleFramedTerminalCount).toBe(0)
  expect(after.baselineInaccessibleFramedTerminalCount).toBe(0)
  expect(after.baselineUnresolvedFramedTerminalCount).toBe(2)
  expect(blockedPendingConnections(originalAccess, [owned, foreign])).toEqual([
    pendingConnection,
  ])
  expect(() =>
    finish(originalAccess.getPreservedReport([owned, foreign])),
  ).toThrow(PendingAccessSearchUnknownError)
  expect(blockedPendingConnections(originalAccess, [owned])).toEqual([])
  expect(blockedPendingConnections(originalAccess, [owned, foreign])).toEqual([
    pendingConnection,
  ])
  expect(input).toEqual(original)
})
