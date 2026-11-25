import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { busLengthReports } from "../lib/route-lengths"
import type { SimpleRouteJson } from "../lib/types"

test("OrangeCrab routes its native control and clock paths beside 22 completed data signals", () => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        `${import.meta.dir}/fixtures/orangecrab-native-control/input.srj.json.gz`,
      ),
    ).toString(),
  )
  const started = performance.now()
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(30)
  const lengths = busLengthReports(input, solver.traces)
  expect(
    lengths
      .filter((bus) => bus.toleranceMm !== null)
      .every((bus) => bus.matched),
  ).toBe(true)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: solver.traces },
      clearance: input.minTraceToPadEdgeClearance,
      allowBlindAndBuriedVias: false,
    } as never).valid,
  ).toBe(true)
  console.log(
    JSON.stringify({
      seconds: (performance.now() - started) / 1000,
      iterations: solver.iterations,
      copperSha256: createHash("sha256")
        .update(JSON.stringify(solver.traces))
        .digest("hex"),
      lengths: lengths.map(({ lengths, ...bus }) => bus),
    }),
  )
}, 120000)
