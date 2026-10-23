import { nativePrefixLengthReports } from "../scripts/audit-native-counterfactual"
import { length } from "../lib/geometry"
import { expect, test } from "bun:test"
import { loadNativeCounterfactual } from "../scripts/native-counterfactual"
test("single-signal pool selection replaces the shortest candidate with a blocked counterfactual", () => {
  const { sample, state, selected, probes, inputUnchanged } =
    loadNativeCounterfactual()
  expect(inputUnchanged).toBe(true)
  expect(selected.value).not.toBeNull()
  const chosen = probes.find((p) => p.selected)!,
    viable = probes.filter((p) => p.next.value)
  expect(probes).toHaveLength(4)
  expect(chosen.choice.layer).toBe("top")
  expect(chosen.next.completed).toBe(true)
  expect(chosen.next.value).toBeNull()
  expect(chosen.next.steps).toBeLessThan(100)
  expect(viable).toHaveLength(3)
  expect(
    viable.every(
      (p) => p.choice.layer === "bottom" && p.length < chosen.length,
    ),
  ).toBe(true)
  const best = viable.sort((a, b) => a.length - b.length)[0].choice
  const audit = nativePrefixLengthReports(sample.secondInput, best.escapes, [
    best.trace,
  ])[0].lengths[0]
  expect(audit.carrierLengthMm).toBeGreaterThan(20)
  expect(audit.fixedLengthMm).toBeGreaterThan(1)
  expect(audit.totalLengthMm).toBeCloseTo(
    length(best.trace.route) +
      best.escapes.reduce((sum, t) => sum + length(t.route), 0),
    8,
  )
  expect(state.native.traces).toEqual(sample.firstOutput.traces)
}, 300000)
