import { expect, test } from "bun:test"
import { PendingAccessSearchUnknownError } from "../lib/pending-access-search-unknown"
import { PendingSurfaceSearch } from "../lib/pending-surface-search"
import { routeSurfaceBridge } from "../lib/route-surface-bridge"
import { CandidateSearchOutcomes } from "../lib/candidate-search-outcomes"
import type { SimpleRouteJson } from "../lib/types"

function finish<T>(search: Generator<void, T>): T {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

function fixture(): SimpleRouteJson {
  const bounds = { minX: -0.6, maxX: 0.6, minY: -0.6, maxY: 0.6 }
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.2,
    minViaHoleDiameter: 0.1,
    bounds,
    obstacles: [],
    traces: [],
    allowedLayers: ["top", "bottom"],
    connections: [
      {
        name: "CONTROL",
        pointsToConnect: [
          { x: -0.3, y: 0, layer: "top" },
          { x: 0.3, y: 0, layer: "top" },
        ],
      },
    ],
    pendingRoutingAccess: [
      {
        bounds,
        minTraceWidth: 0.1,
        connections: [
          {
            name: "FUTURE",
            pointsToConnect: [
              { x: -0.1, y: 0.4, layer: "top" },
              { x: 0.1, y: 0.4, layer: "top" },
            ],
          },
        ],
      },
    ],
  }
}

test("an uncertified goal retains permitted alternatives and a later positive result wins", () => {
  for (const mode of ["verdict", "throw"] as const) {
    const input = fixture(),
      original = structuredClone(input)
    const seen: number[] = []
    const result = finish(
      routeSurfaceBridge(input, input.connections[0], {
        maxExpansions: 10_000,
        maxVias: 2,
        pendingAccessFeedback: () => [],
        acceptRoute: function* (route) {
          const vias = [
            ...route.carrier.route,
            ...route.escapes.flatMap((trace) => trace.route),
          ].filter((point) => point.route_type === "via").length
          seen.push(vias)
          if (!vias) {
            if (mode === "throw") throw new PendingAccessSearchUnknownError()
            return { accepted: false, uncertified: true }
          }
          return { accepted: true }
        },
      }),
    )
    expect(result).not.toBeNull()
    expect(seen).toContain(0)
    expect(seen.some((count) => count > 0)).toBe(true)
    expect(input).toEqual(original)
  }
})

test("an exhausted geometric frontier retains uncertified callback status", () => {
  const input = fixture()
  // Keep both permitted layer/count domains, but no manufactured via can fit
  // this board. The planar goals still exist and reach the callback.
  input.minViaPadDiameter = 2
  let queried = 0
  expect(() =>
    finish(
      routeSurfaceBridge(input, input.connections[0], {
        maxExpansions: 10_000,
        pendingAccessFeedback: () => [],
        acceptRoute: function* () {
          queried++
          return { accepted: false, uncertified: true }
        },
      }),
    ),
  ).toThrow(PendingAccessSearchUnknownError)
  expect(queried).toBeGreaterThan(0)
})

test("duplicate uncertified geometry retains UNKNOWN instead of becoming a finite exhausted domain", () => {
  const input = fixture(),
    search = new PendingSurfaceSearch({
      input,
      maximumExpansions: 20,
      viaCounts: [0, 2],
    })
  const memory = search.attachMemory(8192)
  try {
    search.reject("same_materialized_geometry", {
      terminals: [],
      uncertified: true,
    })
    expect(search.rejection("same_materialized_geometry")).toEqual([])
    expect(search.rejectionWasUncertified("same_materialized_geometry")).toBe(
      true,
    )
    search.uncertified()
    expect(() => search.noSolution()).toThrow(PendingAccessSearchUnknownError)
    expect(search.remaining).toBe(20)
  } finally {
    search.dispose()
  }
  expect(memory.usedBytes).toBe(0)
  const outcomes = new CandidateSearchOutcomes()
  expect(
    finish(
      outcomes.run(
        (function* () {
          throw new PendingAccessSearchUnknownError()
          return null
        })(),
      ),
    ),
  ).toBeNull()
  expect(outcomes.unknownCount).toBe(1)
  expect(
    finish(
      outcomes.run(
        (function* () {
          return "positive candidate"
        })(),
      ),
    ),
  ).toBe("positive candidate")
})
