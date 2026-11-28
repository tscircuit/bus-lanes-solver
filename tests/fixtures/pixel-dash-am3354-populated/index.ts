import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../../../lib"

function readFixture<T>(filename: string): T {
  return JSON.parse(gunzipSync(readFileSync(new URL(filename, import.meta.url))).toString())
}

export function populatedInput() {
  return readFixture<SimpleRouteJson>("input.srj.json.gz")
}

export function fixedCopper() {
  return readFixture<AnyCircuitElement[]>("fixed-copper.circuit.json.gz")
}

export function solvePopulated(input: SimpleRouteJson) {
  const solver = new BusLanesPipelineSolver(input, {
    goal: "connectivity",
    maxRoutingTimeMs: 240_000,
  })
  solver.solve()
  return solver
}
