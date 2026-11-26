import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import {
  BusLanesPipelineSolver,
  type Connection,
  type SimpleRouteJson,
} from "../lib"
import { length } from "../lib/geometry"
import { nativeValidationSrj } from "./fixtures/expect-completed-routing"

test("Glider compaction keeps the declared whole-byte skew bound", (): void => {
  const {
    input,
    fixedConnections,
  }: {
    input: SimpleRouteJson
    fixedConnections: Connection[]
  } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/glider-compaction-skew-bound/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 120000 })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(input).toEqual(original)
  const output = solver.getOutput()
  expect(output.traces.slice(0, input.traces!.length)).toEqual(input.traces!)
  const inputSrj = nativeValidationSrj({
    ...input,
    connections: [...input.connections, ...fixedConnections],
  })
  const routedSrj = nativeValidationSrj({ ...inputSrj, traces: output.traces })
  const connectivity = validateOriginalEndpointConnectivity({
    inputSrj,
    routedSrj,
  })
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(22)
  expect(
    validateRoutedCopperDrc({
      inputSrj,
      routedSrj,
      clearance: input.minTraceToPadEdgeClearance!,
    }).valid,
  ).toBe(true)

  const lengths = solver.traces.map((trace) => length(trace.route))
  const skew = Math.max(...lengths) - Math.min(...lengths)
  const wholeByte = input.buses!.find(
    (bus) => bus.connectionNames.length === input.connections.length,
  )!
  expect({
    skewMm: Number(skew.toFixed(9)),
    withinDeclaredBound: skew <= wholeByte.maxLengthSkew!,
  }).toMatchInlineSnapshot(`
    {
      "skewMm": 0.797042,
      "withinDeclaredBound": true,
    }
  `)
}, 130000)
