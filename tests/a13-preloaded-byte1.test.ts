import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type AnyCircuitElement, pcb_trace } from "circuit-json"
import {
  BusLanesPipelineSolver,
  type Connection,
  type SimpleRouteJson,
} from "../lib"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"

test("routes A13 CPU byte1 beside the unchanged completed first byte", async (): Promise<void> => {
  const { input, fixedConnections, circuit } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/a13-preloaded-byte1/input.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as {
    input: SimpleRouteJson
    fixedConnections: Connection[]
    circuit: AnyCircuitElement[]
  }
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    maxSearchIterations: 20_000,
    singleCarrier: { fixedConnections },
  })
  solver.solve()
  expect(input).toEqual(original)
  expect(input.connections).toHaveLength(8)
  expect(input.traces).toHaveLength(8)
  let traces = input.traces!
  let caption =
    "FAILED: 0/8 new CPU routes accepted; only 8 supplied routes shown"
  if (solver.solved) {
    expectCompletedRouting(solver, original)
    expect(solver.traces).toHaveLength(8)
    traces = solver.getOutput().traces!
    caption =
      "16/16 CPU data routes connected; first byte unchanged; DRC passed"
  }
  circuit.push(...traces.map((trace) => pcb_trace.parse(trace)))
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "routing_status",
    pcb_group_id: "routing_status",
    text: caption,
    anchor_position: { x: 12, y: 15.5 },
    font: "tscircuit2024",
    layer: "top",
    font_size: 0.55,
    anchor_alignment: "center",
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      backgroundColor: "white",
      width: 1400,
      height: 1000,
      viewport: { minX: -10, maxX: 38, minY: -19, maxY: 18 },
      shouldDrawErrors: false,
      shouldDrawRatsNest: false,
      showErrorsInTextOverlay: false,
    },
  })
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
}, 120_000)
