import { test, expect } from "bun:test"
import { routeCoupledPair } from "../lib/coupled-pair-routing"
import { runRotatedPairHandoffCase } from "../scripts/rotated-pair-handoff-case"
test("equivalent rotated pad representations choose identical coupled package handoffs", () => {
  const result = runRotatedPairHandoffCase(routeCoupledPair)
  for (const { report } of result.cases) {
    expect(report.solved).toBe(true)
    expect(report.inputUnchanged).toBe(true)
    expect(report.drc.valid).toBe(true)
    expect(report.pairs.every((p) => p.matched)).toBe(true)
    expect(report.coupling.every((p) => p.matched)).toBe(true)
  }
  expect(result.geometryEqual).toBe(true)
  expect(result.accepted).toBe(true)
}, 120_000)
