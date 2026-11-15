import { expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import { readFileSync } from "node:fs"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { createTerminalViaClearanceChecker } from "../lib/terminal-via-clearance"
import { pairLengthReports } from "../lib/route-lengths"
import { pairCouplingReports } from "../lib/pair-coupling"

test("coupled length correction cannot return through a supplied terminal via", () => {
  const input = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL("./fixtures/usb-terminal-via/input.json.gz", import.meta.url),
      ),
    ).toString(),
  ) as SimpleRouteJson
  const before = JSON.stringify(input)
  const solver = new BusLanesPipelineSolver(input, {
    maxSearchIterations: 2_000_000,
  })
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(4)
  expect(JSON.stringify(input)).toBe(before)
  expect(
    pairLengthReports(input, solver.traces).every((pair) => pair.matched),
  ).toBe(true)
  expect(
    pairCouplingReports(input, solver.traces).every((pair) => pair.matched),
  ).toBe(true)
  for (const trace of solver.traces) {
    expect(
      createTerminalViaClearanceChecker(input, trace, {
        preserveExistingApproach: false,
      })(trace.route),
      trace.connection_name,
    ).toBe(true)
  }
}, 300_000)
