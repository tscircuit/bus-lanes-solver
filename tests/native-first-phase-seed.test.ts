import { expect, test } from "bun:test"
import { planNativePairSeed } from "../lib/plan-native-pair-seed"
import {
  loadFirstPhaseNativeByte,
  firstPhasePairControl,
  auditFirstPhasePair,
} from "../scripts/native-first-phase"

export function drive<T>(work: Generator<unknown, T>) {
  let next = work.next(),
    steps = 0
  while (!next.done) {
    steps++
    next = work.next()
  }
  return { value: next.value, steps }
}
test("first native phase skips an independently valid native pair seed", () => {
  const input = loadFirstPhaseNativeByte(),
    before = structuredClone(input)
  expect(input.traces ?? []).toHaveLength(0)
  expect(drive(planNativePairSeed(input))).toEqual({ value: null, steps: 0 })
  const control = drive(firstPhasePairControl(input))
  expect(control.value).not.toBeNull()
  expect(auditFirstPhasePair(input, control.value!).valid).toBe(true)
  expect(input).toEqual(before)
}, 180000)
