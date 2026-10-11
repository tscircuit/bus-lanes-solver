import { expect, test } from "bun:test"
import {
  compileNativeMatchingHistoryFixture,
  runNativeMatchingHistoryFixture,
} from "./fixtures/native-matching-history"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import {
  nativeMatchingHistoryReport,
  nativeMatchingHistorySvg,
} from "./fixtures/native-matching-history-snapshot"

test("bounded fine repair repeats the same real copper conflict after losing history", async () => {
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
  expect(result.traces).toBeNull()
  expect(result.complete).toBe(true)
  expect(routeAnglesAreConventional(result.diagnosticTraces)).toBe(true)
  expect(result.stages.map((state) => state.stage)).toEqual([
    "native_global_matching",
    ...Array.from(
      { length: 6 },
      (_, index) => `native_local_matching_${index}`,
    ),
  ])
  expect(result.stages.every((state) => state.collisions === 1)).toBe(true)
  expect(result.validation.valid).toBe(false)
  expect(result.validation.issues).toHaveLength(1)
  const [conflict] = result.validation.issues
  expect(conflict.code).toBe("different-net-trace-clearance")
  expect(conflict.layer).toBe("inner1")
  expect(
    [
      signalNames[conflict.connectionName!],
      signalNames[conflict.otherConnectionName!],
    ].sort(),
  ).toEqual(["S0", "S4"])
  expect(input).toEqual(before)
  // Compare the artifact to this actual compiled-and-solved fixture, so the
  // diagnostic geometry, labels and measured lengths cannot go stale.
  const fixture = { input, signalNames }
  expect(nativeMatchingHistorySvg(fixture, result)).toBe(
    await Bun.file(
      new URL(
        "../docs/repros/native-matching-history/before.svg",
        import.meta.url,
      ),
    ).text(),
  )
  expect(nativeMatchingHistoryReport(fixture, result)).toEqual(
    await Bun.file(
      new URL(
        "../docs/repros/native-matching-history/before.json",
        import.meta.url,
      ),
    ).json(),
  )
}, 30000)
