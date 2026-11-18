import { expect, test } from "bun:test"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { expectConnectedAndClear } from "./fixtures/expect-connected-and-clear"
import { pendingIndependentClosuresFixture } from "./fixtures/pending-independent-closures"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"

test("the default release domain repairs independent access cuts without forcing unary-only routing", () => {
  const { input, previous } = pendingIndependentClosuresFixture()
  const original = structuredClone(previous)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), previous.traces),
  ).toHaveLength(2)
  const search = negotiateSurfaceRoutes(input, previous, {
    maxRounds: 1,
    maxExpansions: 100_000,
    maxInitialExpansions: 100_000,
    maxClosureExpansions: 100_000,
    maxCandidateSearchNodes: 10_000,
  })
  let state = search.next()
  while (!state.done) state = search.next()
  expect(state.value).not.toBeNull()
  if (!state.value) return
  const result = state.value
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
  const suppliedConnections = (input.traces ?? []).map((trace) => {
    const first = trace.route[0]
    const last = trace.route.at(-1)!
    if (first.route_type !== "wire" || last.route_type !== "wire")
      throw Error("Fixture supplied traces must terminate on native wires")
    return { name: trace.connection_name!, pointsToConnect: [first, last] }
  })
  expectConnectedAndClear({
    request: input,
    connections: [...suppliedConnections, ...input.connections],
    traces: [...(input.traces ?? []), ...joined],
  })
  expect(previous).toEqual(original)
}, 30_000)
