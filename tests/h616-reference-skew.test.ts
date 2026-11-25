import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  BusLanesPipelineSolver,
  type SimpleRouteJson,
  type Trace,
} from "../lib"
import {
  expectH616Routing,
  type H616Fixture,
} from "./fixtures/expect-h616-routing"

test("fresh H616 DDR routing connects every branch and meets all nine original skew rules", (): void => {
  const fixture: H616Fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-reference-skew/unrouted.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const original = structuredClone(fixture.input),
    generated: Trace[] = [],
    started = performance.now()
  expect(original.traces).toHaveLength(0)
  expect(original.connections).toHaveLength(53)
  for (const [index, phase] of fixture.phases.entries()) {
    const input: SimpleRouteJson = {
      ...original,
      connections: original.connections.filter((c) =>
        phase.names.includes(c.name),
      ),
      traces: structuredClone(generated),
      buses: structuredClone(phase.buses),
    }
    const before = structuredClone(input),
      solver = new BusLanesPipelineSolver(input, {
        maxRoutingTimeMs: Math.max(1, 120000 - (performance.now() - started)),
      })
    solver.solve()
    expect(solver.solved, solver.error ?? `phase ${index}`).toBe(true)
    expect(input).toEqual(before)
    generated.push(...solver.traces)
  }
  expectH616Routing({
    input: original,
    generated,
    clockBuses: fixture.phases[1].buses,
    constraints: fixture.constraints,
    preservation: fixture.preservation,
  })
  expect(fixture.input).toEqual(original)
}, 130000)
