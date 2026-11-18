import { expect, test } from "bun:test"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { generatedEscapeHolesConflict } from "../lib/expanded-signal-sites"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { findPendingPadEscape } from "../lib/pending-pad-escape"
import type { Trace } from "../lib/types"
import { fixedCopper } from "../lib/vector-scene"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"
import { pendingIndependentClosuresFixture } from "./fixtures/pending-independent-closures"

function finish<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

test("separate blocked terminals of one future net must retain independent repair obligations", () => {
  const { input, previous, closures } = pendingIndependentClosuresFixture()
  const options = {
    maxRounds: 1,
    maxExpansions: 100_000,
    maxInitialExpansions: 100_000,
    maxClosureExpansions: 100_000,
    maxCandidateSearchNodes: 10_000,
    maxClosureSize: 1,
  }
  // Obtain the repaired copper from the real public solver on the same
  // geometry, widths and existing copper. Only future grouping changes below.
  const independentlyRepaired = finish(
    negotiateSurfaceRoutes(input, previous, options),
  )
  expect(independentlyRepaired).not.toBeNull()
  if (!independentlyRepaired) return
  const repaired = [
    ...independentlyRepaired.retained,
    ...independentlyRepaired.traces,
  ].map((trace) =>
    joinSignalEscapes(
      trace,
      independentlyRepaired.escapes.filter(
        (escape) => escape.connection_name === trace.connection_name,
      ),
    ),
  )
  const connection = {
    name: "ONE_LATER_NET",
    width: 0.1,
    pointsToConnect: closures.map(
      (closure) => closure.connection.pointsToConnect[0],
    ),
  }
  input.pendingRoutingAccess![0].connections = [connection]
  const original = structuredClone(previous)
  const firstNames = new Set(
    closures[0].traces.map((trace) => trace.connection_name),
  )
  const secondNames = new Set(
    closures[1].traces.map((trace) => trace.connection_name),
  )
  const firstRepaired = previous.traces.map((trace) =>
    firstNames.has(trace.connection_name)
      ? repaired.find(
          (candidate) => candidate.connection_name === trace.connection_name,
        )!
      : trace,
  )
  const secondRepaired = previous.traces.map((trace) =>
    secondNames.has(trace.connection_name)
      ? repaired.find(
          (candidate) => candidate.connection_name === trace.connection_name,
        )!
      : trace,
  )
  const terminalStates = (traces: Trace[]) => {
    const future = {
      ...input.pendingRoutingAccess![0],
      layerCount: input.layerCount,
      obstacles: input.obstacles,
      traces: [...(input.traces ?? []), ...traces],
    }
    return connection.pointsToConnect.map(
      (_, terminalIndex) =>
        !!finish(
          findPendingPadEscape({
            input: future,
            connection,
            terminalIndex,
          }),
        ),
    )
  }
  const access = new PendingPadAccess(input)
  const partialPrefix = [...closures[1].traces, closures[0].traces[0]]
  const physical = {
    baseline: terminalStates([]),
    bothBlocked: terminalStates(previous.traces),
    firstRepaired: terminalStates(firstRepaired),
    secondRepaired: terminalStates(secondRepaired),
    fullyRepaired: terminalStates(repaired),
    partialPrefix: terminalStates(partialPrefix),
    partialWithNewObstruction: terminalStates([
      ...partialPrefix,
      closures[0].traces[1],
    ]),
  }
  expect(physical).toEqual({
    baseline: [true, true],
    bothBlocked: [false, false],
    firstRepaired: [true, false],
    secondRepaired: [false, true],
    fullyRepaired: [true, true],
    partialPrefix: [true, false],
    partialWithNewObstruction: [false, false],
  })
  const blocked = [
    previous.traces,
    firstRepaired,
    secondRepaired,
    partialPrefix,
  ].map((traces) =>
    blockedPendingConnections(access, traces).map(
      (blockedConnection) => blockedConnection.name,
    ),
  )
  expect(blocked).toEqual([
    [connection.name],
    [connection.name],
    [connection.name],
    [connection.name],
  ])
  const conflicts = new CopperConflictIndex()
  for (const traces of [firstRepaired, secondRepaired]) {
    const copper = traces.map((trace) =>
      fixedCopper({ ...input, obstacles: [], traces: [trace] }),
    )
    for (const [index, shapes] of copper.entries()) {
      expect(
        conflicts.firstConflict(shapes, fixedCopper(input), 0.1 - 1e-8),
      ).toBeUndefined()
      for (const other of copper.slice(index + 1)) {
        expect(
          conflicts.firstConflict(shapes, other, 0.1 - 1e-8),
        ).toBeUndefined()
      }
    }
    expect(generatedEscapeHolesConflict(input, traces, input.traces!)).toBe(
      false,
    )
  }
  const result = finish(negotiateSurfaceRoutes(input, previous, options))
  expect(result).not.toBeNull()
  if (!result) return
  const completed = [...result.retained, ...result.traces].map((trace) =>
    joinSignalEscapes(
      trace,
      result.escapes.filter(
        (escape) => escape.connection_name === trace.connection_name,
      ),
    ),
  )
  expect(completed).toHaveLength(4)
  expect(terminalStates(completed)).toEqual([true, true])
  expect(blockedPendingConnections(access, completed)).toEqual([])
  expect(previous).toEqual(original)
}, 20_000)
