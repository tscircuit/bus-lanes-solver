import { expect, test } from "bun:test"
import {
  compileNativeMatchingHistoryFixture,
  runNativeMatchingHistoryFixture,
} from "./fixtures/native-matching-history"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"

test("bounded fine repair routes the Core TSX crossing when coarse history is retained", async () => {
  const { input, circuitJson, signalNames } =
    await compileNativeMatchingHistoryFixture()
  const before = structuredClone(input)
  expect(
    circuitJson.filter((element) => element.type.includes("error")),
  ).toEqual([])
  expect(
    circuitJson.filter((element) => element.type === "pcb_smtpad"),
  ).toHaveLength(12)
  expect(
    circuitJson.filter((element) => element.type === "pcb_keepout"),
  ).toHaveLength(2)
  expect(input.connections).toHaveLength(6)
  expect(Object.values(signalNames)).toEqual([
    "S0",
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
  ])

  const result = runNativeMatchingHistoryFixture(input)
  expect(result.traces).not.toBeNull()
  expect(result.traces).toHaveLength(6)
  expect(result.complete).toBe(true)
  expect(routeAnglesAreConventional(result.diagnosticTraces)).toBe(true)
  expect(result.stages.map((state) => state.stage)).toEqual([
    "native_global_matching",
    "native_local_matching_0",
  ])
  expect(result.stages.map((state) => state.collisions)).toEqual([1, 0])
  expect(result.validation.valid).toBe(true)
  expect(result.validation.issues).toEqual([])
  expect(result.validation.checkedViaCount).toBe(12)
  expect(
    result.traces!.every(
      (trace) =>
        trace.route.filter((point) => point.route_type === "via").length === 2,
    ),
  ).toBe(true)
  expect(input).toEqual(before)
}, 30000)
