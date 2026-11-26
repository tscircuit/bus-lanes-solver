import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { routeSurfaceBridge } from "../lib/route-surface-bridge"
import type { SimpleRouteJson } from "../lib/types"
import { nativeValidationSrj } from "./fixtures/expect-completed-routing"

test("surface candidates meet the required whole-signal minimum before selection", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "data",
        connectionNames: ["signal"],
        minLength: 8,
        maxLength: 9,
      },
    ],
  }
  const original = structuredClone(input)
  const search = routeSurfaceBridge(input, input.connections[0], {
    minLength: 8,
  })
  let step = search.next()
  while (!step.done) step = search.next()
  expect(step.value).not.toBeNull()
  const trace = joinSignalEscapes(step.value!.carrier, step.value!.escapes)
  expect(length(trace.route)).toBeGreaterThanOrEqual(8 - 1e-7)
  expect(length(trace.route)).toBeLessThanOrEqual(9 + 1e-7)
  expect(
    validateRoutedCopperDrc({
      inputSrj: nativeValidationSrj(input),
      routedSrj: nativeValidationSrj({ ...input, traces: [trace] }),
      clearance: 0.1,
      allowBlindAndBuriedVias: false,
    }).valid,
  ).toBe(true)
  expect(input).toEqual(original)
})
