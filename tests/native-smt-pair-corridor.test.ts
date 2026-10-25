import { expect, test } from "bun:test"
import { runNativeSmtPairCase } from "../scripts/native-smt-pair-case"
test("native rectangular-pad fanouts admit a clear coupled connector corridor", () => {
  const { input, report } = runNativeSmtPairCase()
  expect(input.connections.length).toBe(2)
  expect(report.solved).toBe(true)
  expect(report.carriers).toBe(2)
  expect(report.inputUnchanged).toBe(true)
  expect(report.endpoints).toBe(true)
  expect(report.drc.valid).toBe(true)
  expect(report.pairs.every((p) => p.matched)).toBe(true)
  expect(report.coupling.every((p) => p.matched)).toBe(true)
  expect(report.exterior.every((p) => p.matched)).toBe(true)
  expect(report.terminalViaShortcuts).toEqual([])
  expect(report.accepted).toBe(true)
}, 90_000)
