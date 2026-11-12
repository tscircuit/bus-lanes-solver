import { expect, test } from "bun:test"
import {
  reuseSuppliedSignalEscapes,
  suppliedEscapesArePreserved,
} from "../lib/reuse-supplied-signal-escapes"
import type { SimpleRouteJson } from "../lib/types"
import fixture from "./fixtures/hdmi-shared-pad.json"

test("shared escapes require physical continuity, ownership and the SRJ via policy", () => {
  const input = structuredClone(fixture) as SimpleRouteJson
  const targets = new Map([
    ["P", "inner1"],
    ["N", "inner1"],
  ])
  const before = JSON.stringify(input)
  const reused = reuseSuppliedSignalEscapes(input, targets)
  expect(reused.escapes).toHaveLength(2)
  expect(reused.input.connections[0].pointsToConnect[0]).toMatchObject({
    x: -1.5,
    y: 0.5,
    layer: "inner1",
    layers: ["inner1"],
  })
  expect(reused.input.traces![0].connectsTo).toEqual(["ESD.P"])
  expect(JSON.stringify(input)).toBe(before)
  expect(suppliedEscapesArePreserved(reused.escapes, reused.escapes)).toBe(true)
  const moved = structuredClone(reused.escapes)
  moved[0].route[1].x += 0.1
  expect(suppliedEscapesArePreserved(reused.escapes, moved)).toBe(false)
  const resized = structuredClone(reused.escapes)
  const resizedVia = resized[0].route.find((p) => p.route_type === "via")!
  resizedVia.layers = ["top", "inner1"]
  expect(suppliedEscapesArePreserved(reused.escapes, resized)).toBe(false)

  for (const mutation of [
    (i: SimpleRouteJson) => {
      i.traces![0].connection_name = "unrelated"
    },
    (i: SimpleRouteJson) => {
      i.traces![0].route[1].x += 0.1
    },
    (i: SimpleRouteJson) => {
      i.traces![0].route[3].y += 0.1
    },
    (i: SimpleRouteJson) => {
      i.traces![0].curvedSegments = [1]
    },
  ]) {
    const invalid = structuredClone(input)
    mutation(invalid)
    expect(
      reuseSuppliedSignalEscapes(invalid, targets).escapes.map(
        (t) => t.connection_name,
      ),
    ).toEqual(["N"])
  }
  for (const policy of [undefined, false, true]) {
    const configured = {
      ...structuredClone(input),
      allowBlindAndBuriedVias: policy,
    }
    for (const trace of configured.traces!)
      trace.route.find((p) => p.route_type === "via")!.layers = [
        "top",
        "inner1",
      ]
    const original = JSON.stringify(configured)
    if (policy) {
      const result = reuseSuppliedSignalEscapes(configured, targets)
      expect(result.escapes).toHaveLength(2)
      expect(
        result.escapes[0].route.find((p) => p.route_type === "via")!.layers,
      ).toEqual(["top", "inner1"])
    } else {
      expect(() => reuseSuppliedSignalEscapes(configured, targets)).toThrow(
        "allowBlindAndBuriedVias=true",
      )
    }
    expect(JSON.stringify(configured)).toBe(original)
  }
})
