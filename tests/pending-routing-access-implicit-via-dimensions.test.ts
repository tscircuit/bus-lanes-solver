import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { InvalidPendingRoutingAccess } from "../lib/validate-pending-routing-access"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

test("future via dimensions must remain manufacturable when one dimension is omitted", () => {
  for (const dimensions of [
    { minViaPadDiameter: undefined, minViaHoleDiameter: 0.5 },
    { minViaPadDiameter: 0.1, minViaHoleDiameter: undefined },
  ]) {
    const { input } = pendingPadAccessFixture()
    Object.assign(input.pendingRoutingAccess![0]!, dimensions)
    const before = structuredClone(input)
    expect(() => {
      new PendingPadAccess(input)
    }).toThrow(InvalidPendingRoutingAccess)
    expect(input).toEqual(before)
  }

  for (const dimensions of [
    { minViaPadDiameter: undefined, minViaHoleDiameter: 0.2 },
    { minViaPadDiameter: 0.4, minViaHoleDiameter: undefined },
    { minViaPadDiameter: undefined, minViaHoleDiameter: undefined },
  ]) {
    const { input } = pendingPadAccessFixture()
    Object.assign(input.pendingRoutingAccess![0]!, dimensions)
    expect(() => new PendingPadAccess(input)).not.toThrow()
  }

  // New future-intent validation must not change the legacy no-intent path.
  const { input } = pendingPadAccessFixture()
  input.pendingRoutingAccess = undefined
  input.minViaPadDiameter = 0.1
  input.minViaHoleDiameter = 0.5
  expect(() => new PendingPadAccess(input)).not.toThrow()
})
