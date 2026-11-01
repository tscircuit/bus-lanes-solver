import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../../lib"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"

test("routes both real OrangeCrab DDR bytes with shared through-via clearance", () => {
  const input: SimpleRouteJson = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/orangecrab-core-data-bytes/input.srj.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const original = structuredClone(input)
  expect(input.connections).toHaveLength(22)
  expect(input.obstacles).toHaveLength(387)
  const solver = new BusLanesPipelineSolver(input, {
    maxRoutingTimeMs: 180_000,
  })
  solver.solve()
  expectCompletedRouting(solver, original)
  expect(solver.traces).toHaveLength(22)
  expect(
    solver.traces.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
  ).toHaveLength(44)
  for (const bus of busLengthReports(input, solver.traces))
    expect(bus.skewMm!).toBeLessThanOrEqual(0.5)
  for (const pair of pairLengthReports(input, solver.traces))
    expect(pair.skewMm!).toBeLessThanOrEqual(0.1)
  expect(solver.getOutput().buses).toEqual(original.buses)
  expect(solver.getOutput().differentialPairs).toEqual(
    original.differentialPairs,
  )
}, 240_000)
