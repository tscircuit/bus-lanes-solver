import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { type AnyCircuitElement, pcb_trace } from "circuit-json"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { length } from "../lib/geometry"
import { busLengthReports } from "../lib/route-lengths"
import { nativeValidationSrj } from "./fixtures/expect-completed-routing"

test("Glider's second byte accounts for the copper required by matching", async (): Promise<void> => {
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
          "./fixtures/glider-byte1-matching-cost/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const circuit: AnyCircuitElement[] = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/glider-byte1-matching-cost/unrouted.circuit.json.gz",
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
  const supplied = input.traces ?? []
  expect(output.traces.slice(0, supplied.length)).toEqual(supplied)
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
  expect(
    busLengthReports(input, solver.traces).every(
      (report) =>
        report.matched && report.aboveMinimumLength && report.withinLengthLimit,
    ),
  ).toBe(true)

  const lengths = solver.traces.map((trace) => length(trace.route))
  const byte1SkewMm = Number(
    (Math.max(...lengths) - Math.min(...lengths)).toFixed(6),
  )
  expect({
    byte1SkewMm,
    preservesOriginalByteSkew: byte1SkewMm <= 0.797043,
  }).toMatchInlineSnapshot(`
    {
      "byte1SkewMm": 0,
      "preservesOriginalByteSkew": true,
    }
  `)

  circuit.push(...output.traces.map((trace) => pcb_trace.parse(trace)))
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      backgroundColor: "white",
      width: 1000,
      height: 1200,
      viewport: { minX: -28, maxX: -5, minY: -34, maxY: -5 },
      shouldDrawErrors: false,
      shouldDrawRatsNest: false,
      showErrorsInTextOverlay: false,
    },
  })
}, 130000)
