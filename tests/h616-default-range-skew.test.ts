import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"

test("native DDR buses recover with the default range skew mode", () => {
  const fixture: {
    input: SimpleRouteJson
    phases: { names: string[]; buses: NonNullable<SimpleRouteJson["buses"]> }[]
  } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-reference-skew/unrouted.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const phase = fixture.phases[0]
  const input: SimpleRouteJson = {
    ...fixture.input,
    connections: fixture.input.connections.filter((connection) =>
      phase.names.includes(connection.name),
    ),
    // Request ordinary range bounds, including the selected strobe members.
    // No explicit skew mode or solver recovery option is supplied.
    buses: phase.buses.map(
      ({ skewReference, referenceConnectionNames, ...bus }) => ({
        ...bus,
        connectionNames: [
          ...new Set([
            ...bus.connectionNames,
            ...(referenceConnectionNames ?? []),
          ]),
        ],
      }),
    ),
  }
  const original = structuredClone(input)
  expect(input.traces).toHaveLength(0)
  expect(input.connections).toHaveLength(22)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expectCompletedRouting(solver, original)
}, 120000)
