import { expect, test } from "bun:test"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { PendingPadAccess } from "../lib/pending-pad-access"
import {
  findPendingPadEscape,
  PendingPadScene,
} from "../lib/pending-pad-escape"
import type { SimpleRouteJson } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"
import {
  pendingInternalPeersFixture,
  withInternalPeerCopper,
} from "./fixtures/pending-internal-peers"

function exhaust<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

test("same-field future peers retain physical connectivity without requiring field egress", () => {
  const cases = [
    { name: "direct internal wire", options: {}, blocked: false },
    {
      name: "interior wall disconnects internal peers",
      options: { interiorWallHalfLength: 0.4 },
      blocked: true,
    },
    {
      name: "future narrow wire fits interior passage",
      options: { interiorWallHalfLength: 0.4, futureClearance: 0.05 },
      blocked: false,
    },
    {
      name: "future wide wire cannot fit interior passage",
      options: {
        interiorWallHalfLength: 0.4,
        futureClearance: 0.05,
        futureWidth: 0.2,
      },
      blocked: true,
    },
    {
      name: "native top path does not grant a forbidden carrier layer",
      options: { futureAllowedLayers: ["bottom"] },
      blocked: true,
    },
    {
      name: "allowed blind vias retain an inner carrier path",
      options: {
        enclosureHalfSize: 1.2,
        interiorWallHalfLength: 1.0,
        layerCount: 4,
        futureAllowedLayers: ["inner1"],
        allowBlindAndBuriedVias: true,
      },
      blocked: false,
    },
    {
      name: "through-via rules include obstructed bottom copper",
      options: {
        enclosureHalfSize: 1.2,
        interiorWallHalfLength: 1.0,
        layerCount: 4,
        futureAllowedLayers: ["inner1"],
        allowBlindAndBuriedVias: false,
      },
      blocked: true,
    },
  ]
  const observations = []
  for (const entry of cases) {
    const fixture = pendingInternalPeersFixture(entry.options)
    const { input, pendingConnection, addedCopper } = fixture
    const original = structuredClone(input)
    const future: SimpleRouteJson = {
      ...input.pendingRoutingAccess![0],
      layerCount: input.layerCount,
      obstacles: input.obstacles,
      traces: input.traces,
    }
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
    if (entry.name === "direct internal wire") {
      const changed = withInternalPeerCopper({ input: future, addedCopper })
      const scene = new VectorScene(
        changed,
        pendingConnection,
        0.1,
        fixedCopper(changed),
      )
      expect(scene.pathVisible(pendingConnection.pointsToConnect)).toBe(true)
    }
    if (entry.name === "future narrow wire fits interior passage") {
      const changed = withInternalPeerCopper({ input: future, addedCopper })
      const scene = new VectorScene(
        changed,
        pendingConnection,
        0.1,
        fixedCopper(changed),
      )
      expect(
        scene.pathVisible([
          pendingConnection.pointsToConnect[0],
          { x: -0.2, y: 0.55 },
          { x: 0.2, y: 0.55 },
          pendingConnection.pointsToConnect[1],
        ]),
      ).toBe(true)
    }
    if (input.layerCount === 4) {
      const changed = withInternalPeerCopper({ input: future, addedCopper })
      const scene = new PendingPadScene({
        input: changed,
        connection: pendingConnection,
        terminalIndex: 0,
      })
      expect(scene.viaSpan({ x: -0.6, y: 0 }, "inner1")).toEqual(
        future.allowBlindAndBuriedVias ? ["top", "inner1"] : undefined,
      )
    }
    const access = new PendingPadAccess(input)
    expect(blockedPendingConnections(access, [])).toEqual([])
    const blocked = blockedPendingConnections(access, addedCopper)
    observations.push({ name: entry.name, blocked: blocked.length > 0 })
    expect(input).toEqual(original)
  }
  const external = pendingPadAccessFixture()
  const externalAccess = new PendingPadAccess(external.input)
  expect(blockedPendingConnections(externalAccess, [])).toEqual([])
  observations.push({
    name: "outside peer still requires field egress",
    blocked:
      blockedPendingConnections(externalAccess, [
        external.upperLeft,
        external.lowerRight,
      ]).length > 0,
  })
  expect(observations).toEqual([
    ...cases.map(({ name, blocked }) => ({ name, blocked })),
    { name: "outside peer still requires field egress", blocked: true },
  ])
}, 30_000)
