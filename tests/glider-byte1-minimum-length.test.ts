import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { busLengthReports } from "../lib/route-lengths"
import { nativeValidationSrj } from "./fixtures/expect-completed-routing"

test("Glider byte1 reaches its full length beside completed byte0", (): void => {
  const {
    input,
    fixedConnections,
  }: {
    input: SimpleRouteJson
    fixedConnections: SimpleRouteJson["connections"]
  } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/glider-byte1-minimum-length/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 120000 })
  solver.solve()
  expect(input).toEqual(original)
  if (solver.solved) {
    const native = nativeValidationSrj({
      ...input,
      connections: [...input.connections, ...fixedConnections],
    })
    const routed = nativeValidationSrj({
      ...native,
      traces: solver.getOutput().traces,
    })
    expect(
      validateOriginalEndpointConnectivity({
        inputSrj: native,
        routedSrj: routed,
      }).connectedConnectionCount,
    ).toBe(22)
    expect(
      validateRoutedCopperDrc({
        inputSrj: native,
        routedSrj: routed,
        clearance: input.minTraceToPadEdgeClearance!,
      }).valid,
    ).toBe(true)
    expect(
      busLengthReports(input, solver.traces).every(
        (report) =>
          report.matched &&
          report.aboveMinimumLength &&
          report.withinLengthLimit,
      ),
    ).toBe(true)
    const supplied = input.traces ?? []
    expect(solver.getOutput().traces.slice(0, supplied.length)).toEqual(supplied)
  }
  expect(solver.solved).toMatchInlineSnapshot(`false`)
}, 130000)
