import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import type { Trace } from "../lib/types"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

function finish<T>(search: Generator<void, T>): T {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

test("preserved-access evidence counts the checked union and rejects a blocked union", () => {
  const { input, upperLeft, lowerRight } = pendingPadAccessFixture()
  const fixed: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "supplied_control",
    connection_name: "SUPPLIED_CONTROL",
    route: [
      { route_type: "wire", x: -5, y: -5, layer: "top", width: 0.1 },
      { route_type: "wire", x: -4, y: -5, layer: "top", width: 0.1 },
    ],
  }
  input.traces = [fixed]
  const original = structuredClone(input)
  const access = new PendingPadAccess(input)
  const report = finish(access.getPreservedReport([fixed, upperLeft]))
  expect(report).toEqual({
    outcome: "preserved",
    declaredConnectionCount: 1,
    declaredTerminalCount: 2,
    framedTerminalCount: 2,
    baselineAccessibleFramedTerminalCount: 2,
    baselineInaccessibleFramedTerminalCount: 0,
    peerConnectionCount: 0,
    validatedTraceCount: 2,
    newlyBlockedConnectionNames: [],
  })
  // Returned evidence is not a mutable alias of the oracle's accepted state.
  Object.assign(report!, { validatedTraceCount: 999 })
  expect(
    finish(access.getPreservedReport([upperLeft]))?.validatedTraceCount,
  ).toBe(2)
  expect(() =>
    finish(access.getPreservedReport([fixed, upperLeft, lowerRight])),
  ).toThrow("Routing could not certify access for later connections")
  expect(input).toEqual(original)

  const noIntent = new PendingPadAccess({
    ...input,
    pendingRoutingAccess: undefined,
  })
  expect(
    finish(noIntent.getPreservedReport([upperLeft, lowerRight])),
  ).toBeUndefined()
  expect(input).toEqual(original)
})
