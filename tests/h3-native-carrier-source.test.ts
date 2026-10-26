import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { runH3NativeCarrierRepro } from "../scripts/repro-h3-native-carrier"

test("freshly route the unchanged real H3 eleven-signal byte and export its actual SVG", () => {
  const report = runH3NativeCarrierRepro()
  const snapshot = new URL("../docs/h3-native-carrier/result.snap.svg", import.meta.url)
  if (process.env.BUN_UPDATE_SNAPSHOTS === "1") writeFileSync(snapshot, report.svg)
  expect(report.svg).toBe(readFileSync(snapshot, "utf8"))
  expect(report.inputUnchanged).toBe(true)
  expect(report.svg).toContain("479 original pads (443 circles)")
  expect(report.solver.solved).toBe(true)
  expect(report.solver.failed).toBe(false)
  expect(report.solver.error).toBeNull()
  expect(report.validation?.connectivity.connectedConnectionCount).toBe(11)
  expect(report.validation?.connectivity.connectedEndpointCount).toBe(22)
  expect(report.validation?.connectivity.issues).toEqual([])
  expect(report.validation?.copperDrc.issues).toEqual([])
  expect(report.validation?.drillPadOverlaps).toEqual([])
  expect(report.svg).toContain("COMPLETED: 11/11 physically connected")
  expect(report.svg).toContain("copper DRC 0 | drill/pad overlaps 0")
})
