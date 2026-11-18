import { expect, test } from "bun:test"
import { traceStaysInsideOutline } from "../lib/board-outline"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { generatedEscapeHolesConflict } from "../lib/expanded-signal-sites"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import { distance } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { fixedCopper } from "../lib/vector-scene"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("surface negotiation reroutes a collectively blocking union while retaining normal clearance", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  input.connections = [upperLeft, lowerRight].map((trace) => ({
    name: trace.connection_name!,
    width: 0.1,
    pointsToConnect: [trace.route[0], trace.route.at(-1)!].map((point) => ({
      x: point.x,
      y: point.y,
      layer: "top",
    })),
  }))
  const previous: FlexibleSignalState = {
    native: input,
    pending: input,
    escapes: [],
    retained: [],
    traces: [upperLeft, lowerRight],
  }
  const original = structuredClone(previous)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), previous.traces).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])

  const negotiation = negotiateSurfaceRoutes(input, previous, {
    maxRounds: 1,
    maxExpansions: 100_000,
    maxInitialExpansions: 100_000,
    maxClosureExpansions: 100_000,
    maxCandidateSearchNodes: 10_000,
  })
  let step = negotiation.next()
  while (!step.done) step = negotiation.next()
  const result = step.value

  expect(result).not.toBeNull()
  if (!result) return
  const joined = result.traces.map((trace) =>
    joinSignalEscapes(
      trace,
      result.escapes.filter(
        (escape) => escape.connection_name === trace.connection_name,
      ),
    ),
  )
  expect(joined).toHaveLength(2)
  expect(joined.map((trace) => trace.connection_name).sort()).toEqual([
    "DATA_0",
    "DATA_1",
  ])
  expect(
    blockedPendingConnections(new PendingPadAccess(input), joined),
  ).toEqual([])

  const copper = joined.map((trace) =>
    fixedCopper({
      ...input,
      obstacles: [],
      traces: [trace],
    }),
  )
  const conflict = new CopperConflictIndex()
  expect(
    conflict.firstConflict(copper[0], copper[1], 0.1 - 1e-8),
  ).toBeUndefined()
  const supplied = fixedCopper(input)
  for (const [index, trace] of joined.entries()) {
    const connection = input.connections.find(
      (item) => item.name === trace.connection_name,
    )!
    expect(
      distance(trace.route[0], connection.pointsToConnect[0]),
    ).toBeLessThan(1e-8)
    expect(
      distance(trace.route.at(-1)!, connection.pointsToConnect[1]),
    ).toBeLessThan(1e-8)
    expect(
      conflict.firstConflict(copper[index], supplied, 0.1 - 1e-8),
    ).toBeUndefined()
    expect(traceStaysInsideOutline(input, trace)).toBe(true)
  }
  expect(generatedEscapeHolesConflict(input, joined, [])).toBe(false)
  expect(previous).toEqual(original)
}, 60_000)
