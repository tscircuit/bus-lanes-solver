import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type AnyCircuitElement, pcb_trace } from "circuit-json"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"

const readFixture = (name: string): string =>
  gunzipSync(
    readFileSync(
      new URL(
        `./fixtures/stm32mp157d-ddr-dqs-pair-tuning/${name}`,
        import.meta.url,
      ),
    ),
  ).toString("utf8")

const status = (
  text: string,
  x: number,
  y: number,
  fontSize: number,
): AnyCircuitElement => ({
  type: "pcb_note_text",
  pcb_note_text_id: "routing_status",
  pcb_group_id: "routing_status",
  text,
  anchor_position: { x, y },
  font: "tscircuit2024",
  layer: "top",
  font_size: fontSize,
  anchor_alignment: "center",
})

const svgOptions = {
  backgroundColor: "white",
  shouldDrawErrors: false,
  shouldDrawRatsNest: false,
  showErrorsInTextOverlay: false,
} as const

// Both DDR data bytes and their DQS pairs on inner3. Each DQS pair leaves
// U70 side by side and enters U71 stacked, so its rails differ by 1.12 mm.
test("routes and matches STM32MP157D DDR data bytes with their DQS pairs", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(readFixture("input.srj.json.gz"))
  const circuit: AnyCircuitElement[] = JSON.parse(
    readFixture("unrouted.circuit.json.gz"),
  )
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  let caption =
    "FAILED BASELINE: 0/22 DDR data and strobe signals connected; the DQS0 pair cannot be length-matched"
  if (solver.solved) {
    expectCompletedRouting(solver, original)
    circuit.push(...solver.traces.map((trace) => pcb_trace.parse(trace)))
    caption =
      "COMPLETED: 22/22 DDR data and strobe signals connected and matched; DRC passed"
  }
  await expect([...circuit, status(caption, 0, 50, 1.6)]).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      ...svgOptions,
      width: 1600,
      height: 1000,
      viewport: { minX: -78, maxX: 78, minY: -49.5, maxY: 51.5 },
    },
  })
  await expect([...circuit, status(caption, 9, 48.6, 0.45)]).toMatchPcbSnapshot(
    {
      testPath: import.meta.path,
      snapshotName: "ddr",
      svgOptions: {
        ...svgOptions,
        width: 900,
        height: 1340,
        viewport: { minX: -4, maxX: 22, minY: 10, maxY: 49.2 },
      },
    },
  )
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
})
