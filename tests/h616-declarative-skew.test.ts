import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import {
  expectH616Routing,
  type H616Fixture,
} from "./fixtures/expect-h616-routing"

test("Core's unchanged H616 TSX input solves in one phase with default options", () => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-reference-skew/declarative.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const reference: H616Fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-reference-skew/unrouted.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const before = structuredClone(input)
  expect(input.traces).toHaveLength(0)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.solved, solver.error ?? undefined).toBe(true)
  expect(input).toEqual(before)
  expectH616Routing({
    input,
    generated: solver.traces,
    clockBuses: input.buses ?? [],
    constraints: reference.constraints,
    preservation: reference.preservation,
  })
}, 130000)
