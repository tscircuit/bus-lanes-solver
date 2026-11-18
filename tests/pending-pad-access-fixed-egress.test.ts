import { expect, test } from "bun:test"
import { applyToPoint, rotateDEG } from "transformation-matrix"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingPadGeometry } from "../lib/pending-pad-geometry"
import {
  PendingPadScene,
  findPendingPadEscape,
  pendingPadEscapeIsClear,
} from "../lib/pending-pad-escape"
import type { SimpleRouteJson, Trace } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import {
  fixedEgressFixture,
  futureInput,
  withCandidate,
} from "./fixtures/pending-fixed-egress"

function finish<Result>(search: Generator<void, Result>): Result {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

function blocked(input: SimpleRouteJson, traces: readonly Trace[]): string[] {
  return finish(
    new PendingPadAccess(input).getUncertifiedConnections(traces),
  ).map((connection) => connection.name)
}

test("actual old copper outside the package discharges egress without a new wider handoff", () => {
  const observed = []
  for (const topology of ["wire", "via_chain"] as const) {
    const { input, pendingConnection, addedCopper, outside } =
      fixedEgressFixture(topology)
    const original = structuredClone({ input, addedCopper })
    const future = futureInput(input)
    const changed = withCandidate(future, addedCopper)
    const scene = new PendingPadScene({
      input: changed,
      connection: pendingConnection,
      terminalIndex: 0,
    })
    expect(scene.frame).toBeDefined()
    const local = applyToPoint(scene.frame!.boardToPackage, outside)
    expect(local.y).toBeGreaterThan(scene.frame!.field.maxY + scene.width / 2)
    expect(scene.surfaceExit(outside)).toBe(true)
    // The new future-wide wire cannot be placed at the old exit. This is the
    // distinction from ordinary future-width handoff witnesses.
    expect(scene.scene.visible(outside, outside)).toBe(false)
    const current = new VectorScene(
      input,
      pendingConnection,
      0.05,
      fixedCopper({ ...input, traces: [...input.traces!, ...addedCopper] }),
    )
    expect(current.visible(outside, outside)).toBe(true)
    const geometry = new PendingPadGeometry(changed)
    expect(
      geometry.ownedCarrierAccess(pendingConnection).connectedContacts({
        from: { point: pendingConnection.pointsToConnect[0], layer: "top" },
        to: { point: outside, layer: "top" },
      }),
    ).toBe(true)
    // The rail exclusion intervals overlap and cover every possible center
    // contacting the supplied wire/via, not just the center sample above.
    const clearanceRadius = scene.width / 2 + 0.05 / 2 + 0.1
    const oldExitRadius = topology === "wire" ? 0.05 / 2 : 0.2 / 2
    const contactRadius = scene.width / 2 + oldExitRadius
    expect(-1.2 + clearanceRadius).toBeGreaterThan(-0.8 - clearanceRadius)
    expect(-1 - contactRadius).toBeGreaterThan(-1.2 - clearanceRadius)
    expect(-1 + contactRadius).toBeLessThan(-0.8 + clearanceRadius)
    expect(3 + contactRadius).toBeLessThan(3.75)
    const conflict = new CopperConflictIndex()
    const copper = addedCopper.map((trace) =>
      fixedCopper({ ...input, obstacles: [], traces: [trace] }),
    )
    for (const old of fixedCopper({ ...input, obstacles: [] })) {
      const layered = {
        ...pendingConnection,
        pointsToConnect: pendingConnection.pointsToConnect.map((point) => ({
          ...point,
          layer: old.layer,
        })),
      }
      const oldScene = new VectorScene(
        input,
        layered,
        old.radius * 2,
        fixedCopper({
          ...input,
          traces: [...input.traces!, ...addedCopper],
        }),
      )
      expect(oldScene.visible(old.a, old.b)).toBe(true)
    }
    if (topology === "via_chain")
      for (const trace of input.traces!)
        for (const via of trace.route) {
          if (via.route_type !== "via") continue
          const manufacture = new PendingPadScene({
            input: {
              ...input,
              traces: [
                ...input.traces!.filter((other) => other !== trace),
                ...addedCopper,
              ],
            },
            connection: pendingConnection,
            terminalIndex: 0,
            terminalLayer: via.from_layer,
          })
          expect(manufacture.viaSpan(via, via.to_layer)).toEqual([
            "top",
            "inner1",
          ])
        }
    for (const [index, shapes] of copper.entries()) {
      expect(
        conflict.firstConflict(shapes, fixedCopper(input), 0.05 - 1e-8),
      ).toBeUndefined()
      for (const other of copper.slice(index + 1))
        expect(
          conflict.firstConflict(shapes, other, 0.05 - 1e-8),
        ).toBeUndefined()
    }
    expect(blocked(input, [])).toEqual([])
    observed.push({ topology, blocked: blocked(input, addedCopper) })
    expect({ input, addedCopper }).toEqual(original)
  }
  expect(observed).toEqual([
    { topology: "wire", blocked: [] },
    { topology: "via_chain", blocked: [] },
  ])
})

test("a disconnected same-owner spur or exit on a forbidden layer does not discharge egress", () => {
  const { input, pendingConnection, addedCopper, outside } =
    fixedEgressFixture()
  const disconnected = structuredClone(input)
  disconnected.traces = disconnected.traces!.filter(
    (trace) => trace.pcb_trace_id !== "supplied_inner_link",
  )
  const forbidden = structuredClone(input)
  forbidden.traces = forbidden.traces!.filter(
    (trace) => trace.pcb_trace_id !== "supplied_return",
  )
  for (const value of [disconnected, forbidden]) {
    expect(blocked(value, [])).toEqual([])
    expect(blocked(value, addedCopper)).toEqual([pendingConnection.name])
  }
  const physical = new PendingPadGeometry(
    withCandidate(futureInput(forbidden), addedCopper),
  )
  const owned = physical.ownedCarrierAccess(pendingConnection)
  expect(
    owned.connectedContacts({
      from: { point: pendingConnection.pointsToConnect[0], layer: "top" },
      to: { point: outside, layer: "inner1" },
    }),
  ).toBe(true)
  expect(
    owned.connectedContacts({
      from: { point: pendingConnection.pointsToConnect[0], layer: "top" },
      to: { point: outside, layer: "top" },
    }),
  ).toBe(false)
})

test("a fixed-egress witness revalidates removed conductors, owner aliases and physical spans", () => {
  const { input, pendingConnection, addedCopper } = fixedEgressFixture()
  const changed = withCandidate(futureInput(input), addedCopper)
  const request = {
    input: changed,
    connection: pendingConnection,
    terminalIndex: 0,
  }
  const escape = finish(findPendingPadEscape(request))
  expect(escape).not.toBeNull()
  if (!escape) return
  expect(pendingPadEscapeIsClear(request, escape)).toBe(true)
  const variants = [
    (traces: Trace[]) =>
      traces.filter((trace) => trace.pcb_trace_id !== "supplied_inner_link"),
    // Metadata-only ownership mutation is a defensive stale-witness control,
    // not a claim that changing the net of touching fixed copper is DRC-valid.
    (traces: Trace[]) =>
      traces.map((trace) =>
        trace.pcb_trace_id === "supplied_inner_link"
          ? {
              ...trace,
              connection_name: "FOREIGN",
              source_trace_id: "foreign_source",
            }
          : trace,
      ),
    (traces: Trace[]) =>
      traces.map((trace) =>
        trace.pcb_trace_id === "supplied_return"
          ? {
              ...trace,
              route: trace.route.map((point) =>
                point.route_type === "via"
                  ? {
                      ...point,
                      from_layer: "inner1",
                      to_layer: "inner2",
                      layers: ["inner1", "inner2"],
                    }
                  : point,
              ),
            }
          : trace,
      ),
  ]
  for (const mutate of variants) {
    const fresh = {
      ...changed,
      traces: mutate(structuredClone(changed.traces!)),
    }
    expect(pendingPadEscapeIsClear({ ...request, input: fresh }, escape)).toBe(
      false,
    )
  }
  const retainedAlias = {
    ...changed,
    traces: changed.traces!.map((trace) =>
      trace.pcb_trace_id === "supplied_inner_link"
        ? { ...trace, connection_name: "RENAMED_BRANCH" }
        : trace,
    ),
  }
  expect(
    pendingPadEscapeIsClear({ ...request, input: retainedAlias }, escape),
  ).toBe(true)
  expect(pendingPadEscapeIsClear(request, escape)).toBe(true)
})

test("a cached egress witness cannot retain an owned current route removed from the candidate union", () => {
  const { input, pendingConnection, addedCopper, outside } =
    fixedEgressFixture()
  const original = structuredClone({ input, addedCopper })
  const mutable: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "mutable_owned_egress",
    connection_name: pendingConnection.name,
    source_trace_id: pendingConnection.source_trace_id,
    route: [
      ...input.traces!.flatMap((trace) => trace.route),
      { route_type: "wire", ...outside, layer: "top", width: 0.05 },
    ],
  }
  const current: SimpleRouteJson = {
    ...input,
    traces: [],
    connections: [
      ...input.connections,
      {
        name: mutable.connection_name!,
        source_trace_id: mutable.source_trace_id,
        width: 0.05,
        pointsToConnect: [
          pendingConnection.pointsToConnect[0],
          { ...outside, layer: "top" },
        ],
      },
    ],
  }
  const access = new PendingPadAccess(current)
  const restored = {
    ...structuredClone(mutable),
    pcb_trace_id: "restored_owned_egress",
  }
  const alias = {
    ...structuredClone(mutable),
    pcb_trace_id: "aliased_owned_egress",
    connection_name: "RENAMED_CURRENT_BRANCH",
  }
  const observed = [
    finish(access.getUncertifiedConnections([...addedCopper, mutable])),
    finish(access.getUncertifiedConnections(addedCopper)),
    finish(access.getUncertifiedConnections([...addedCopper, restored])),
    finish(access.getUncertifiedConnections([...addedCopper, alias])),
    finish(access.getUncertifiedConnections(addedCopper)),
  ].map((connections) => connections.map((connection) => connection.name))
  expect({ input, addedCopper }).toEqual(original)
  expect(observed).toEqual([
    [],
    [pendingConnection.name],
    [],
    [],
    [pendingConnection.name],
  ])
})

test("finite old copper can cross a rotated field even when every centerline vertex stays inside", () => {
  for (const angle of [0, 45]) {
    const { input, pendingConnection, addedCopper } = fixedEgressFixture("wire")
    const initial = new PendingPadScene({
      input: futureInput(input),
      connection: pendingConnection,
      terminalIndex: 0,
    })
    input.traces![0].route.at(-1)!.y = initial.frame!.field.maxY - 0.01
    const rotation = rotateDEG(angle)
    for (const trace of [...input.traces!, ...addedCopper])
      for (const point of trace.route)
        Object.assign(point, applyToPoint(rotation, point))
    for (const connection of [
      ...input.connections,
      ...input.pendingRoutingAccess![0].connections,
    ])
      for (const point of connection.pointsToConnect)
        Object.assign(point, applyToPoint(rotation, point))
    for (const obstacle of input.obstacles) {
      obstacle.center = applyToPoint(rotation, obstacle.center)
      obstacle.ccwRotationDegrees = (obstacle.ccwRotationDegrees ?? 0) + angle
    }
    input.outline = input.outline!.map((point) => applyToPoint(rotation, point))
    input.bounds = {
      minX: Math.min(...input.outline.map((point) => point.x)),
      maxX: Math.max(...input.outline.map((point) => point.x)),
      minY: Math.min(...input.outline.map((point) => point.y)),
      maxY: Math.max(...input.outline.map((point) => point.y)),
    }
    input.pendingRoutingAccess![0].outline = structuredClone(input.outline)
    input.pendingRoutingAccess![0].bounds = { ...input.bounds }
    const changed = withCandidate(futureInput(input), addedCopper)
    const request = {
      input: changed,
      connection: pendingConnection,
      terminalIndex: 0,
    }
    const scene = new PendingPadScene(request)
    const frame = scene.frame!
    for (const point of input.traces![0].route) {
      const local = applyToPoint(frame.boardToPackage, point)
      expect(local.x).toBeGreaterThanOrEqual(frame.field.minX - 1e-8)
      expect(local.x).toBeLessThanOrEqual(frame.field.maxX + 1e-8)
      expect(local.y).toBeGreaterThanOrEqual(frame.field.minY - 1e-8)
      expect(local.y).toBeLessThanOrEqual(frame.field.maxY + 1e-8)
    }
    const witness = finish(findPendingPadEscape(request))!
    expect(witness.existingEgress).toBeDefined()
    const contact = applyToPoint(
      frame.boardToPackage,
      witness.existingEgress!.point,
    )
    expect(
      contact.x < frame.field.minX ||
        contact.x > frame.field.maxX ||
        contact.y < frame.field.minY ||
        contact.y > frame.field.maxY,
    ).toBe(true)
    expect(pendingPadEscapeIsClear(request, witness)).toBe(true)
    expect(blocked(input, addedCopper)).toEqual([])
  }
})
