import { expect, test } from "bun:test"
import { generatedEscapeHolesConflict } from "../lib/expanded-signal-sites"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { joinedSignalGeometryIsValid } from "../lib/joined-signal-geometry"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingPadScene } from "../lib/pending-pad-escape"
import type { Trace } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { blockedPendingConnections } from "./fixtures/pending-pad-access"
import { pendingOwnedRecoveryFixture } from "./fixtures/pending-owned-recovery"

function finish<T>(search: Generator<void, T>, cancelled: T): T {
  let result = search.next()
  let observedSteps = 0
  try {
    while (!result.done) {
      // Keep this known search-diversity regression bounded in CI. This is an
      // observation limit, not a solver budget or an infeasibility verdict.
      if (++observedSteps > 5_000)
        throw Error(
          "Owned access repair remains unresolved after 5000 cooperative observation steps",
        )
      result = search.next()
    }
    return result.value
  } finally {
    if (!result.done) search.return(cancelled)
  }
}

test("an unseeded sole owner must continue past a goal that does not restore frozen-blocked access", () => {
  const { input, previous, frozen, currentConnection, pendingConnection } =
    pendingOwnedRecoveryFixture("name")
  currentConnection.pointsToConnect[1] = { x: 0, y: 0.4, layer: "top" }
  previous.traces = []
  const original = structuredClone(previous)
  const currentInput = {
    ...input,
    traces: frozen,
    pendingRoutingAccess: undefined,
  }
  const physical = new PendingPadScene({
    input: currentInput,
    connection: currentConnection,
    terminalIndex: 0,
  })
  const direct: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "short_nonrestoring_current_branch",
    connection_name: currentConnection.name,
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 0.4, layer: "top", width: 0.1 },
    ],
  }
  const restoring: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "valid_restoring_current_branch",
    connection_name: currentConnection.name,
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0.5, y: 0.5, layer: "top", width: 0.1 },
      {
        route_type: "via",
        x: 0.5,
        y: 0.5,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { route_type: "wire", x: 0.5, y: 0.5, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: -0.5, y: 0.5, layer: "bottom", width: 0.1 },
      {
        route_type: "via",
        x: -0.5,
        y: 0.5,
        from_layer: "bottom",
        to_layer: "top",
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { route_type: "wire", x: -0.5, y: 0.5, layer: "top", width: 0.1 },
      { route_type: "wire", x: -0.1, y: 0.5, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 0.4, layer: "top", width: 0.1 },
    ],
  }
  expect(physical.scene.pathVisible(direct.route)).toBe(true)
  for (const point of [
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
  ])
    expect(physical.viaSpan(point, "bottom")).toEqual(["top", "bottom"])
  for (const shape of fixedCopper({
    ...input,
    obstacles: [],
    traces: [restoring],
  })) {
    const scene = new VectorScene(
      currentInput,
      {
        ...currentConnection,
        pointsToConnect: currentConnection.pointsToConnect.map((point) => ({
          ...point,
          layer: shape.layer,
        })),
      },
      shape.radius * 2,
      fixedCopper(currentInput),
    )
    expect(scene.visible(shape.a, shape.b)).toBe(true)
  }
  expect(
    joinedSignalGeometryIsValid({
      input,
      trace: restoring,
      smoothTuning: false,
    }),
  ).toBe(true)
  expect(generatedEscapeHolesConflict(input, [restoring], frozen)).toBe(false)
  const access = new PendingPadAccess(input)
  expect(
    blockedPendingConnections(access, frozen).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
  expect(
    blockedPendingConnections(access, [...frozen, direct]).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
  expect(blockedPendingConnections(access, [...frozen, restoring])).toEqual([])

  const result = finish(
    negotiateSurfaceRoutes(input, previous, {
      frozenConnectionNames: new Set(
        frozen.map((trace) => trace.connection_name!),
      ),
      maxRounds: 0,
      maxUntimedVias: 2,
      maxExpansions: 10_000,
      maxInitialExpansions: 10_000,
      maxClosureExpansions: 10_000,
    }),
    null,
  )
  expect(result).not.toBeNull()
  if (!result) return
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
}, 15_000)
