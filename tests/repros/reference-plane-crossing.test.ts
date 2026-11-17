import { expect, test } from "bun:test"
import { checkReferenceCoverage } from "../../repros/reference-plane-crossing/check-reference-coverage"
import { runCase } from "../../repros/reference-plane-crossing/run"

test("reference-plane gap: stock solver and copper DRC accept an unreferenced bottom crossing", () => {
  const result = runCase()
  expect(result.solved).toBe(true)
  expect(result.fixedCopperUnchanged).toBe(true)
  expect(result.copperDrc.issues).toEqual([])
  expect(result.referenceCoverage.checkedSegments).toBe(1)
  expect(result.referenceCoverage.covered).toBe(false)
  expect(result.referenceCoverage.minimumEdgeGapMm).toBeCloseTo(-0.305, 9)
})

test("a projection on another signal layer does not protect the bottom reference", () => {
  const result = runCase("top")
  expect(result.solved).toBe(true)
  expect(result.copperDrc.issues).toEqual([])
  expect(result.referenceCoverage.covered).toBe(false)
})

test("caller-supplied bottom projection gives a completed route with continuous reference coverage", () => {
  const result = runCase("bottom")
  expect(result.solved).toBe(true)
  expect(result.fixedCopperUnchanged).toBe(true)
  expect(result.copperDrc.issues).toEqual([])
  expect(result.referenceCoverage.covered).toBe(true)
  expect(result.referenceCoverage.minimumEdgeGapMm).toBeGreaterThanOrEqual(
    0.1 - 1e-9,
  )
  expect(result.traces).toHaveLength(1)
  const route = result.traces[0].route
  expect(route[0]).toMatchObject({ x: -4, y: 0, layer: "bottom" })
  expect(route.at(-1)).toMatchObject({ x: 4, y: 0, layer: "bottom" })
  expect(
    route.every((p) => p.route_type === "wire" && p.layer === "bottom"),
  ).toBe(true)
})

test("the independent reference check does not pass an empty output vacuously", () => {
  expect(checkReferenceCoverage([]).covered).toBe(false)
})
