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
  expect(state.native.traces).toEqual(sample.firstOutput.traces)
}, 300000)
