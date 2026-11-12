import "bun-match-svg"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib"
import {
  loadMt8395HdmiInput,
  hashMt8395Input,
} from "./fixtures/mt8395-hdmi-input"
import { mt8395HdmiRoutingSnapshot } from "./fixtures/mt8395-hdmi-routing-snapshot"

test("MT8395 HDMI package reconnection exceeds the board-wide grid budget", async () => {
  const input = loadMt8395HdmiInput()
  const before = hashMt8395Input(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(input.connections).toHaveLength(2)
  expect(input.traces).toHaveLength(138)
  expect(hashMt8395Input(input)).toBe(before)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("Dense grid search budget exceeded")
  expect(solver.traces).toHaveLength(0)
  await expect(mt8395HdmiRoutingSnapshot(input, [])).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 300_000)
