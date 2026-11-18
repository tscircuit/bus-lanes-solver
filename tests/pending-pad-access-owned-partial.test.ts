import { expect, test } from "bun:test"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"
import { pendingOwnedRecoveryFixture } from "./fixtures/pending-owned-recovery"

test("a partial foreign candidate may coexist with another variable that restores owned future access", () => {
  for (const alias of ["name", "source_trace_id", "terminal"] as const) {
    const { input, previous, frozen, owned } =
      pendingOwnedRecoveryFixture(alias)
    input.connections.push({
      name: "UNRELATED_CURRENT",
      width: 0.1,
      pointsToConnect: [
        { x: -5, y: 4, layer: "top" },
        { x: -4, y: 4, layer: "top" },
      ],
    })
    const original = structuredClone(previous)
    expect(
      blockedPendingConnections(new PendingPadAccess(input), frozen),
    ).toHaveLength(1)
    expect(
      blockedPendingConnections(new PendingPadAccess(input), [
        ...frozen,
        owned,
      ]),
    ).toEqual([])
    const negotiation = negotiateSurfaceRoutes(input, previous, {
      frozenConnectionNames: new Set(
        frozen.map((trace) => trace.connection_name!),
      ),
      maxRounds: 0,
      maxExpansions: 10_000,
      maxInitialExpansions: 10_000,
      maxClosureExpansions: 10_000,
    })
    let step = negotiation.next()
    while (!step.done) step = negotiation.next()
    const result = step.value
    expect(result).not.toBeNull()
    if (!result) continue
    const accepted = [...result.retained, ...result.traces].map((trace) =>
      joinSignalEscapes(
        trace,
        result.escapes.filter(
          (escape) => escape.connection_name === trace.connection_name,
        ),
      ),
    )
    expect(result.traces.map((trace) => trace.connection_name).sort()).toEqual(
      [owned.connection_name!, "UNRELATED_CURRENT"].sort(),
    )
    expect(
      blockedPendingConnections(new PendingPadAccess(input), accepted),
    ).toEqual([])
    expect(result.retained).toEqual(frozen)
    expect(previous).toEqual(original)
  }
}, 60_000)
