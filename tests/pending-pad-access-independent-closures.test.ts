import { expect, test } from "bun:test"
import { traceStaysInsideOutline } from "../lib/board-outline"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { generatedEscapeHolesConflict } from "../lib/expanded-signal-sites"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { fixedCopper } from "../lib/vector-scene"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"
import { pendingIndependentClosuresFixture } from "./fixtures/pending-independent-closures"

function finish<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

test("independent access conflicts can be repaired while other closures remain blocked", () => {
  const { input, previous, closures } = pendingIndependentClosuresFixture()
  const original = structuredClone(previous)
  const access = new PendingPadAccess(input)
  expect(
    blockedPendingConnections(access, previous.traces)
      .map((connection) => connection.name)
      .sort(),
  ).toEqual(closures.map((closure) => closure.connection.name).sort())
  for (const closure of closures) {
    expect(
      blockedPendingConnections(access, closure.traces).map(
        (connection) => connection.name,
      ),
    ).toEqual([closure.connection.name])
    const unrelatedPrefix = closures
      .filter((other) => other !== closure)
      .flatMap((other) => other.traces)
    // The other closure is blocked already, but this originally accessible
    // obligation is still preserved and must reject its own new obstruction.
    expect(
      finish(
        access.getUncertifiedConnections(unrelatedPrefix, {
          connection: closure.connection,
        }),
      ),
    ).toEqual([])
    expect(
      finish(
        access.getUncertifiedConnections(
          [...unrelatedPrefix, ...closure.traces],
          {
            connection: closure.connection,
          },
        ),
      ),
    ).toEqual([closure.connection])
  }
  const negotiation = negotiateSurfaceRoutes(input, previous, {
    maxRounds: 1,
    maxExpansions: 100_000,
    maxInitialExpansions: 100_000,
    maxClosureExpansions: 100_000,
    maxCandidateSearchNodes: 10_000,
    maxClosureSize: 1,
  })
  let step = negotiation.next()
  while (!step.done) step = negotiation.next()
  const result = step.value
  expect(result).not.toBeNull()
  if (!result) return
  const joined = [...result.retained, ...result.traces].map((trace) =>
    joinSignalEscapes(
      trace,
      result.escapes.filter(
        (escape) => escape.connection_name === trace.connection_name,
      ),
    ),
  )
  expect(joined).toHaveLength(4)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), joined),
  ).toEqual([])
  const copper = joined.map((trace) =>
    fixedCopper({ ...input, obstacles: [], traces: [trace] }),
  )
  const conflicts = new CopperConflictIndex()
  const supplied = fixedCopper(input)
  for (const [index, trace] of joined.entries()) {
    expect(traceStaysInsideOutline(input, trace)).toBe(true)
    expect(
      conflicts.firstConflict(copper[index], supplied, 0.1 - 1e-8),
    ).toBeUndefined()
    for (const other of copper.slice(index + 1)) {
      expect(
        conflicts.firstConflict(copper[index], other, 0.1 - 1e-8),
      ).toBeUndefined()
    }
  }
  expect(generatedEscapeHolesConflict(input, joined, input.traces!)).toBe(false)
  expect(previous).toEqual(original)
}, 60_000)
