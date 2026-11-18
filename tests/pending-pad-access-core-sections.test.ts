import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { expectConnectedAndClear } from "./fixtures/expect-connected-and-clear"

interface CapturedCase {
  sample: string
  file: string
  inputSha256: string
  gzipSha256: string
  futureConnections: number
}
const directory = new URL("./fixtures/pending-core-sections/", import.meta.url)
const provenance = JSON.parse(
  readFileSync(new URL("provenance.json", directory), "utf8"),
) as {
  records: CapturedCase[]
}

for (const capture of provenance.records)
  test("native Core sectioned-net access: " + capture.sample, () => {
    const compressed = readFileSync(new URL(capture.file, directory))
    expect(createHash("sha256").update(compressed).digest("hex")).toBe(
      capture.gzipSha256,
    )
    const bytes = gunzipSync(compressed)
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      capture.inputSha256,
    )
    const input = JSON.parse(bytes.toString("utf8")) as SimpleRouteJson
    const original = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input)
    // A reproduction deadline supervises default solver options; exceeding it
    // is an unfinished test, never evidence of electrical infeasibility.
    const deadline = performance.now() + 15_000
    while (!solver.solved && !solver.failed && performance.now() < deadline)
      solver.step()
    if (!solver.solved && !solver.failed)
      throw Error(
        "Native section routing remains unresolved at the observation deadline",
      )
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    const traces = solver.getOutput().traces
    expect(traces).toHaveLength(input.connections.length)
    expect(input.traces).toEqual([])
    expect(input.obstacles.every((obstacle) => obstacle.type === "rect")).toBe(
      true,
    )
    expect(typeof input.minTraceToPadEdgeClearance).toBe("number")
    expectConnectedAndClear({
      request: input,
      connections: input.connections,
      traces,
    })
    const terminals = input
      .pendingRoutingAccess!.flatMap((group) => group.connections)
      .reduce((sum, connection) => sum + connection.pointsToConnect.length, 0)
    expect(solver.getPendingRoutingAccessReport()).toEqual({
      outcome: "preserved",
      declaredConnectionCount: capture.futureConnections,
      declaredTerminalCount: terminals,
      framedTerminalCount: terminals,
      baselineAccessibleFramedTerminalCount: terminals,
      baselineInaccessibleFramedTerminalCount: 0,
      peerConnectionCount: 0,
      validatedTraceCount: traces.length,
      newlyBlockedConnectionNames: [],
    })
    expect(input).toEqual(original)
  }, 20_000)
