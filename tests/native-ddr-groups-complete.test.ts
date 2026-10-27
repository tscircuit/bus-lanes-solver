import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { loadNativeGroupFixture } from "../scripts/native-group-fixtures"
import { validateNativeGroups } from "../scripts/validate-native-groups"

test("default routing completes all 47 DDR signals on a populated six-layer AM3352 layout", async () => {
  const { input, native } = loadNativeGroupFixture("ram-minus29")
  const before = JSON.stringify(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  expect(JSON.stringify(input)).toBe(before)
  expect(solver.traces).toHaveLength(47)
  const validation = await validateNativeGroups(input, native, solver.traces)
  expect(validation.valid).toBe(true)
}, 360000)
