import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { findPendingPadEscape } from "../lib/pending-pad-escape"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib/types"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"
import { validatePendingTerminalWitness } from "./fixtures/pending-access-certificates"

function drain<T>(search: Generator<unknown, T>): T {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

function fixture({
  clearance,
  windowMm = 0.8,
}: {
  clearance: number | undefined
  windowMm?: number
}) {
  const { input, pendingConnection } = pendingPadAccessFixture()
  input.obstacles = input.obstacles.filter(
    (pad) => !pad.layers.includes("bottom"),
  )
  const left = 0.6 - windowMm / 2,
    right = 0.6 + windowMm / 2
  const bottom = -windowMm / 2,
    top = windowMm / 2
  // The only Bottom opening admits a 0.4mm via under the declared specific
  // clearance. A larger generic pad clearance would erase this real baseline.
  for (const [minX, maxX, minY, maxY] of [
    [-6, left, -6, 6],
    [right, 6, -6, 6],
    [left, right, -6, bottom],
    [left, right, top, 6],
  ])
    input.obstacles.push({
      type: "rect",
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      layers: ["bottom"],
      connectedTo: ["GROUND"],
    })
  const intent = input.pendingRoutingAccess![0]
  intent.allowedLayers = ["bottom"]
  intent.minPadEdgeToPadEdgeClearance = 0.3
  intent.minViaEdgeToPadEdgeClearance = clearance
  const halfLength = windowMm > 0.5 ? 0.2 : 0.05
  const candidate: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "current_control",
    connection_name: "CONTROL",
    route: [-halfLength, halfLength].map((dx) => ({
      route_type: "wire",
      x: 0.6 + dx,
      y: 0,
      layer: "bottom",
      width: 0.1,
    })),
  }
  input.connections = [
    {
      name: "CONTROL",
      pointsToConnect: candidate.route.map((point) => ({
        x: point.x,
        y: point.y,
        layer: "bottom",
      })),
    },
  ]
  const future: SimpleRouteJson = {
    ...input,
    ...intent,
    pendingRoutingAccess: undefined,
  }
  return { input, future, pendingConnection, candidate }
}

test("a smaller specific via clearance preserves a demonstrated baseline and its real blocking obligation", () => {
  for (const parameters of [
    { clearance: 0.1 },
    { clearance: 0, windowMm: 0.44 },
  ]) {
    const { input, future, pendingConnection, candidate } = fixture(parameters)
    const original = structuredClone(input)
    const concrete = validatePendingTerminalWitness({
      input,
      traces: [],
      phaseIndex: 0,
      connection: pendingConnection,
      terminalIndex: 0,
      witness: {
        path: [
          { x: 0, y: 0 },
          { x: 0.6, y: 0 },
        ],
        layer: "top",
        via: { point: { x: 0.6, y: 0 }, layers: ["top", "bottom"] },
      },
    })
    expect(concrete.issues).toEqual([])
    expect(concrete.valid).toBe(true)
    const currentScene = new VectorScene(
      input,
      input.connections[0],
      0.1,
      fixedCopper(input),
    )
    expect(currentScene.pathVisible(candidate.route)).toBe(true)
    const witness = drain(
      findPendingPadEscape({
        input: future,
        connection: pendingConnection,
        terminalIndex: 0,
      }),
    )
    expect(witness?.via).toBeDefined()
    const certificate = validatePendingTerminalWitness({
      input,
      traces: [],
      phaseIndex: 0,
      connection: pendingConnection,
      terminalIndex: 0,
      witness,
    })
    expect(certificate.issues).toEqual([])
    expect(certificate.valid).toBe(true)
    const access = new PendingPadAccess(input)
    const baseline = drain(access.getPreservedReport([]))!
    expect(baseline.baselineAccessibleFramedTerminalCount).toBe(2)
    expect(baseline.baselineInaccessibleFramedTerminalCount).toBe(0)
    expect(
      drain(access.getUncertifiedConnections([candidate])).map(
        (connection) => connection.name,
      ),
    ).toEqual([pendingConnection.name])
    expect(input).toEqual(original)
  }
})

test("generic via-pad fallback and larger explicit clearances remain physical constraints", () => {
  const { future, pendingConnection } = fixture({ clearance: undefined })
  const request = {
    input: future,
    connection: pendingConnection,
    terminalIndex: 0,
  }
  expect(drain(findPendingPadEscape(request))).toBeNull()
  expect(
    drain(
      findPendingPadEscape({
        ...request,
        input: { ...future, minPadEdgeToPadEdgeClearance: 0.1 },
      }),
    )?.via,
  ).toBeDefined()
  expect(
    drain(
      findPendingPadEscape({
        ...request,
        input: {
          ...future,
          minViaEdgeToPadEdgeClearance: 0.3,
          minPadEdgeToPadEdgeClearance: 0.1,
        },
      }),
    ),
  ).toBeNull()
  const ordinary = { ...future, minPadEdgeToPadEdgeClearance: undefined }
  expect(
    drain(findPendingPadEscape({ ...request, input: ordinary }))?.via,
  ).toBeDefined()
})
