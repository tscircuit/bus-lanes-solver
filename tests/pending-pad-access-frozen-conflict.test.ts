import { expect, test } from "bun:test"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingAccessSearchUnknownError } from "../lib/pending-access-search-unknown"
import {
  blockedPendingConnections,
  pendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

test("a blocking immutable route union cannot become a zero-edge successful selection", () => {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  input.connections = [upperLeft, lowerRight].map((trace) => ({
    name: trace.connection_name!,
    width: 0.1,
    pointsToConnect: [trace.route[0]!, trace.route.at(-1)!].map((point) => ({
      x: point.x,
      y: point.y,
      layer: "top",
    })),
  }))
  input.differentialPairs = [
    {
      connectionNames: [input.connections[0]!.name, input.connections[1]!.name],
      lengthTolerance: 1,
    },
  ]
  const previous: FlexibleSignalState = {
    native: input,
    pending: input,
    retained: [upperLeft, lowerRight],
    traces: [],
    escapes: [],
  }
  const original = structuredClone(previous)
  expect(
    blockedPendingConnections(
      new PendingPadAccess(input),
      previous.retained,
    ).map((connection) => connection.name),
  ).toEqual([pendingConnection.name])
  const negotiation = negotiateSurfaceRoutes(input, previous)
  expect(() => {
    let state = negotiation.next()
    while (!state.done) state = negotiation.next()
  }).toThrow(PendingAccessSearchUnknownError)
  expect(previous).toEqual(original)
})
