import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { VectorScene, fixedCopper } from "../lib/vector-scene"
import { validatePendingTerminalWitness } from "./fixtures/pending-access-certificates"
import { pendingOffGridWindow } from "./fixtures/pending-off-grid-window"

function drain<T>(search: Generator<unknown, T>): T {
  let state = search.next()
  while (!state.done) state = search.next()
  return state.value
}

function failureFrom(search: Generator<unknown, unknown>): unknown {
  try {
    drain(search)
  } catch (error) {
    return error
  }
  return undefined
}

test("an independently valid off-grid baseline cannot be erased before accepting changed copper", () => {
  for (const clearance of [0, 0.1]) {
    const fixture = pendingOffGridWindow(clearance)
    const {
      input,
      future,
      control,
      candidate,
      witness,
      via,
      admissibleViaCenters,
    } = fixture
    const original = structuredClone(input)
    const request = {
      input,
      traces: [],
      phaseIndex: 0,
      connection: future,
      terminalIndex: 0,
      witness,
    }
    // Establish physical feasibility before asking the sampled router anything.
    expect(validatePendingTerminalWitness(request).issues).toEqual([])
    expect(validatePendingTerminalWitness(request).valid).toBe(true)
    expect(
      new VectorScene(input, control, 0.1, fixedCopper(input)).pathVisible(
        candidate.route,
      ),
    ).toBe(true)

    // Every possible manufactured via center lies over this control segment.
    // Its greatest centerline distance is 0.001mm, below the required land /
    // wire radii and wire clearance. This covers the whole continuous window.
    expect(admissibleViaCenters.minX).toBeGreaterThan(candidate.route[0].x)
    expect(admissibleViaCenters.maxX).toBeLessThan(candidate.route[1].x)
    const greatestDistance = Math.max(
      Math.abs(admissibleViaCenters.minY - via.y),
      Math.abs(admissibleViaCenters.maxY - via.y),
    )
    expect(greatestDistance).toBeLessThan(fixture.landMm / 2 + 0.1 / 2 + 0.1)
    expect(
      validatePendingTerminalWitness({ ...request, traces: [candidate] }).valid,
    ).toBe(false)

    const access = new PendingPadAccess(input)
    // An unresolved finite baseline is not proved continuously inaccessible.
    // Repeating a changed query must not reuse a cached absence or publish it.
    expect(
      failureFrom(access.getBlockedConnections([candidate])),
    ).toMatchObject({ code: "pending_access_search_unknown" })
    expect(
      failureFrom(access.getBlockedConnections([candidate])),
    ).toMatchObject({ code: "pending_access_search_unknown" })
    expect(failureFrom(access.getPreservedReport([candidate]))).toMatchObject({
      code: "pending_access_search_unknown",
    })
    expect(input).toEqual(original)
  }
})
