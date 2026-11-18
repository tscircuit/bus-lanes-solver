import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { signalWidth } from "../lib/repair-bus-dogbones"
import type { SimpleRouteJson } from "../lib/types"
import {
  blockedPendingConnections,
  addUnrelatedFutureConnection,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

function widthGapFixture() {
  const fixture = pendingPadAccessFixture()
  fixture.upperLeft.route[0].y = -0.35
  fixture.upperLeft.route[2].x = 0.35
  fixture.lowerRight.route[0].y = 0.35
  fixture.lowerRight.route[2].x = -0.35
  return { ...fixture, copper: [fixture.upperLeft, fixture.lowerRight] }
}

function futureInput(input: SimpleRouteJson): SimpleRouteJson {
  return { ...input, ...input.pendingRoutingAccess![0] }
}

test("the first owning bus width wins over later buses and stale connection widths", () => {
  const { input, pendingConnection, copper } = widthGapFixture()
  pendingConnection.nominalTraceWidth = 0.3
  pendingConnection.width = 0.4
  const future = input.pendingRoutingAccess![0]
  addUnrelatedFutureConnection(input)
  future.minTraceWidth = 0.3
  future.buses = [
    { busId: "unrelated", connectionNames: ["OTHER_NET"], traceWidth: 0.5 },
    {
      busId: "first",
      connectionNames: [pendingConnection.name],
      traceWidth: 0.1,
    },
    {
      busId: "second",
      connectionNames: [pendingConnection.name],
      traceWidth: 0.3,
    },
  ]
  const original = structuredClone(input)

  expect(signalWidth(futureInput(input), pendingConnection)).toBe(0.1)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), copper),
  ).toEqual([])

  const reversed = structuredClone(input)
  reversed.pendingRoutingAccess![0].buses!.reverse()
  const reversedConnection = reversed.pendingRoutingAccess![0].connections[0]
  expect(signalWidth(futureInput(reversed), reversedConnection)).toBe(0.3)
  expect(
    blockedPendingConnections(new PendingPadAccess(reversed), copper).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
  expect(input).toEqual(original)
})

test("nominal width takes precedence over legacy width and the future minimum fallback", () => {
  const { input, pendingConnection, copper } = widthGapFixture()
  pendingConnection.nominalTraceWidth = 0.1
  pendingConnection.width = 0.3
  input.pendingRoutingAccess![0].minTraceWidth = 0.3

  expect(signalWidth(futureInput(input), pendingConnection)).toBe(0.1)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), copper),
  ).toEqual([])

  const legacy = structuredClone(input)
  const legacyConnection = legacy.pendingRoutingAccess![0].connections[0]
  legacyConnection.nominalTraceWidth = undefined
  expect(signalWidth(futureInput(legacy), legacyConnection)).toBe(0.3)
  expect(
    blockedPendingConnections(new PendingPadAccess(legacy), copper).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])
})

test("future minimum width is used only when bus, nominal and legacy widths are omitted", () => {
  const { input, pendingConnection, copper } = widthGapFixture()
  input.minTraceWidth = 0.4
  input.pendingRoutingAccess![0].minTraceWidth = 0.3

  // The explicit legacy width remains authoritative even below the fallback.
  expect(signalWidth(futureInput(input), pendingConnection)).toBe(0.1)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), copper),
  ).toEqual([])

  pendingConnection.width = undefined
  expect(signalWidth(futureInput(input), pendingConnection)).toBe(0.3)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), copper).map(
      (connection) => connection.name,
    ),
  ).toEqual([pendingConnection.name])

  input.pendingRoutingAccess![0].minTraceWidth = 0.1
  expect(signalWidth(futureInput(input), pendingConnection)).toBe(0.1)
  expect(
    blockedPendingConnections(new PendingPadAccess(input), copper),
  ).toEqual([])
})
