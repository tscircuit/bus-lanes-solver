import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../../lib"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"

test("routes and matches the real OrangeCrab byte captured from core", () => {
  const input: SimpleRouteJson = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/orangecrab-core-byte0/input.srj.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const original = structuredClone(input)
  expect(input.connections).toHaveLength(11)
  expect(input.obstacles).toHaveLength(387)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 60_000 })
  solver.solve()
  expectCompletedRouting(solver, original)
  // Match against strict caller bounds after joining and cleaning all copper.
  // The solver's numerical acceptance epsilon must not become a core error.
  expect(busLengthReports(input, solver.traces)[0].skewMm!).toBeLessThanOrEqual(
    0.5,
  )
  expect(
    pairLengthReports(input, solver.traces)[0].skewMm!,
  ).toBeLessThanOrEqual(0.1)
  expect(solver.getOutput().buses).toEqual(original.buses)
  expect(solver.getOutput().differentialPairs).toEqual(
    original.differentialPairs,
  )
}, 120_000)
