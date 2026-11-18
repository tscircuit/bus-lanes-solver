import { expect, test } from "bun:test"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { findPendingPadEscape } from "../lib/pending-pad-escape"
import type { SimpleRouteJson } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"
import {
  pendingFlexibleInternalPeersFixture,
  pendingInternalCarrierSpurFixture,
  withInternalPeerCopper,
} from "./fixtures/pending-internal-peers"

function exhaust<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

test("internal connectivity uses a legal future carrier rather than a native-only path or dead-end spur", () => {
  const cases = [
    {
      name: "flexible terminals with clear bottom",
      fixture: pendingFlexibleInternalPeersFixture(false),
      blocked: false,
    },
    {
      name: "flexible terminals with bottom too narrow",
      fixture: pendingFlexibleInternalPeersFixture(true),
      blocked: true,
    },
    {
      name: "old bottom dead-end stub",
      fixture: pendingInternalCarrierSpurFixture(),
      blocked: true,
    },
  ]
  const observations = []
  for (const entry of cases) {
    const { input, pendingConnection, addedCopper } = entry.fixture
    const original = structuredClone(input)
    const future: SimpleRouteJson = {
      ...input.pendingRoutingAccess![0],
      layerCount: input.layerCount,
      obstacles: input.obstacles,
      traces: input.traces,
    }
    const changed = withInternalPeerCopper({ input: future, addedCopper })
    for (const terminalIndex of [0, 1]) {
      expect(
        exhaust(
          findPendingPadEscape({
            input: future,
            connection: pendingConnection,
            terminalIndex,
          }),
        ),
      ).not.toBeNull()
    }
    const top = new VectorScene(
      changed,
      pendingConnection,
      pendingConnection.width!,
      fixedCopper(changed),
    )
    expect(top.pathVisible(pendingConnection.pointsToConnect)).toBe(true)
    if (entry.name.startsWith("flexible")) {
      const bottomConnection = {
        ...pendingConnection,
        pointsToConnect: pendingConnection.pointsToConnect.map((terminal) => ({
          ...terminal,
          layer: "bottom",
        })),
      }
      const bottom = new VectorScene(
        changed,
        bottomConnection,
        pendingConnection.width!,
        fixedCopper(changed),
      )
      expect(bottom.pathVisible(bottomConnection.pointsToConnect)).toBe(
        !entry.blocked,
      )
    }
    const conflicts = new CopperConflictIndex()
    const candidateCopper = addedCopper.map((trace) =>
      fixedCopper({ ...input, obstacles: [], traces: [trace] }),
    )
    for (const [index, copper] of candidateCopper.entries()) {
      expect(
        conflicts.firstConflict(copper, fixedCopper(input), 0.1 - 1e-8),
      ).toBeUndefined()
      for (const other of candidateCopper.slice(index + 1)) {
        expect(
          conflicts.firstConflict(copper, other, 0.1 - 1e-8),
        ).toBeUndefined()
      }
    }
    const access = new PendingPadAccess(input)
    expect(blockedPendingConnections(access, [])).toEqual([])
    observations.push({
      name: entry.name,
      blocked: blockedPendingConnections(access, addedCopper).length > 0,
    })
    expect(input).toEqual(original)
  }
  expect(observations).toEqual(
    cases.map(({ name, blocked }) => ({ name, blocked })),
  )
})
