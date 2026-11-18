import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingPeerAccessUnknownError } from "../lib/pending-peer-access"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { fixedCopper } from "../lib/vector-scene"
import type { Trace } from "../lib/types"
import {
  pendingInternalCarrierSpurFixture,
  pendingInternalPeersFixture,
} from "./fixtures/pending-internal-peers"

function finish<T>(search: Generator<void, T>): T {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

test("internal peer preservation replaces egress only with a complete original carrier certificate", () => {
  const internal = pendingInternalPeersFixture()
  const internalAccess = new PendingPadAccess(internal.input)
  const internalReport = finish(
    internalAccess.getPreservedReport(internal.addedCopper),
  )!
  expect(internalReport.framedTerminalCount).toBe(0)
  expect(internalReport.peerConnectionCount).toBe(1)
  expect(internalReport.declaredTerminalCount).toBe(2)

  // Forbidden native layers keep their local via/handoff obligations: a
  // native-only path or an old carrier spur cannot replace them.
  const stub = pendingInternalCarrierSpurFixture()
  const original = structuredClone(stub.input)
  const stubAccess = new PendingPadAccess(stub.input)
  const originalReport = finish(stubAccess.getPreservedReport([]))!
  expect(originalReport.framedTerminalCount).toBe(2)
  expect(originalReport.baselineAccessibleFramedTerminalCount).toBe(2)
  expect(originalReport.peerConnectionCount).toBe(0)
  const blocked = finish(stubAccess.getBlockedObligations(stub.addedCopper))
  expect(blocked.length).toBeGreaterThan(0)
  expect(blocked.every((obligation) => obligation.kind === "terminal")).toBe(
    true,
  )
  expect(() => finish(stubAccess.getPreservedReport(stub.addedCopper))).toThrow(
    "Routing could not certify access",
  )
  expect(stub.input).toEqual(original)
})

test("an eligible but disconnected original peer forest retains positive local egress", () => {
  const { input } = pendingInternalPeersFixture()
  input.pendingRoutingAccess![0].minViaPadDiameter = 20
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.1,
    height: 12,
    layers: ["top"],
    connectedTo: ["SUPPLIED_SEPARATOR"],
  })
  const fence: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "left_egress_fence",
    connection_name: "LEFT_EGRESS_FENCE",
    route: [
      { x: -0.2, y: -0.5, route_type: "wire", layer: "top", width: 0.1 },
      { x: -0.6, y: -0.5, route_type: "wire", layer: "top", width: 0.1 },
      { x: -0.6, y: 0.5, route_type: "wire", layer: "top", width: 0.1 },
      { x: -0.2, y: 0.5, route_type: "wire", layer: "top", width: 0.1 },
    ],
  }
  expect(
    new CopperConflictIndex().firstConflict(
      fixedCopper({ ...input, obstacles: [], traces: [fence] }),
      fixedCopper(input),
      0.1 - 1e-8,
    ),
  ).toBeUndefined()
  const access = new PendingPadAccess(input)
  const baseline = finish(access.getPreservedReport([]))!
  expect(baseline.framedTerminalCount).toBe(2)
  expect(baseline.baselineAccessibleFramedTerminalCount).toBe(2)
  expect(baseline.peerConnectionCount).toBe(0)
  const blocked = finish(access.getBlockedObligations([fence]))
  expect(blocked).toHaveLength(1)
  expect(blocked[0]).toMatchObject({ kind: "terminal", terminalIndex: 0 })
})

test("an unknown internal original carrier search cannot erase egress obligations", () => {
  const { input } = pendingInternalPeersFixture()
  input.pendingRoutingAccess![0].bounds = {
    minX: -1e8,
    maxX: 1e8,
    minY: -1e8,
    maxY: 1e8,
  }
  const access = new PendingPadAccess(input)
  expect(() => finish(access.getUncertifiedConnections([]))).toThrow(
    PendingPeerAccessUnknownError,
  )
  expect(() => finish(access.getUncertifiedConnections([]))).toThrow(
    PendingPeerAccessUnknownError,
  )
})
