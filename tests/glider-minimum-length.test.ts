import { expect, test } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  BusLanesPipelineSolver,
  type Connection,
  type SimpleRouteJson,
} from "../lib"
import { busLengthReports } from "../lib/route-lengths"
import { nativeValidationSrj } from "./fixtures/expect-completed-routing"

test("routes Glider's second matched byte beside its completed first byte", (): void => {
  // Unchanged Core request: abe9820, core-ddr-benchmark 16b6352.
  const { input, fixedConnections } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/glider-minimum-length/input.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as { input: SimpleRouteJson; fixedConnections: Connection[] }
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  expect(solver.traces).toHaveLength(11)
  expect(input).toEqual(original)
  const output = solver.getOutput()
  expect(output.traces.slice(0, input.traces!.length)).toEqual(input.traces!)

  const connections = [...input.connections, ...fixedConnections]
  const native = {
    inputSrj: nativeValidationSrj({ ...input, connections }),
    routedSrj: nativeValidationSrj({ ...output, connections }),
  }
  expect(validateOriginalEndpointConnectivity(native)).toMatchObject({
    valid: true,
    connectedConnectionCount: 22,
  })
  expect(
    validateRoutedCopperDrc({
      ...native,
      clearance: input.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    }),
  ).toMatchObject({ valid: true })
  const lengths = busLengthReports(input, solver.traces)
  expect(
    lengths.every(
      (bus) => bus.matched && bus.aboveMinimumLength && bus.withinLengthLimit,
    ),
  ).toBe(true)
  console.info("Glider matched byte:", {
    iterations: solver.iterations,
    lengths: lengths.map(({ busId, skewMm }) => ({ busId, skewMm })),
    envelope: solver.stats.envelopeOptimization,
  })
}, 120_000)
