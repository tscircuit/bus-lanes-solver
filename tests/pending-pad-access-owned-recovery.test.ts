import { expect, test } from "bun:test"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingPadScene } from "../lib/pending-pad-escape"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"
import { pendingOwnedRecoveryFixture } from "./fixtures/pending-owned-recovery"

test("mutable owned copper can restore a future terminal beyond a blocking frozen union", () => {
  for (const alias of ["name", "source_trace_id", "terminal"] as const) {
    const {
      input,
      previous,
      frozen,
      owned,
      currentConnection,
      pendingConnection,
    } = pendingOwnedRecoveryFixture(alias)
    const original = structuredClone(previous)
    const physical = new PendingPadScene({
      input: { ...input, traces: frozen, pendingRoutingAccess: undefined },
      connection: currentConnection,
      terminalIndex: 0,
    })
    expect(
      physical.scene.pathVisible([
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
      ]),
    ).toBe(true)
    expect(physical.viaSpan({ x: 0.5, y: 0.5 }, "bottom")).toEqual([
      "top",
      "bottom",
    ])
    expect(physical.viaSpan({ x: -3.5, y: -3.5 }, "bottom")).toEqual([
      "top",
      "bottom",
    ])
    const fixedInput = { ...input, traces: frozen }
    for (const shape of fixedCopper({
      ...input,
      obstacles: [],
      traces: [owned],
    })) {
      const scene = new VectorScene(
        fixedInput,
        {
          ...currentConnection,
          pointsToConnect: currentConnection.pointsToConnect.map((point) => ({
            ...point,
            layer: shape.layer,
          })),
        },
        shape.radius * 2,
        fixedCopper(fixedInput),
      )
      expect(scene.visible(shape.a, shape.b)).toBe(true)
    }
    expect(
      blockedPendingConnections(new PendingPadAccess(input), frozen).map(
        (connection) => connection.name,
      ),
    ).toEqual([pendingConnection.name])
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
      maxExpansions: 1,
      maxInitialExpansions: 1,
      maxClosureExpansions: 1,
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
    expect(
      blockedPendingConnections(new PendingPadAccess(input), accepted),
    ).toEqual([])
    expect(result.retained).toEqual(frozen)
    expect(previous).toEqual(original)
  }
})
