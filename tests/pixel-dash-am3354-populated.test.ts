import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { pcb_trace, pcb_via, type AnyCircuitElement } from "circuit-json"
import {
  fixedCopper,
  populatedInput,
  solvePopulated,
} from "./fixtures/pixel-dash-am3354-populated"

test("connects all 50 Pixel Dash DDR signals on the populated board", async () => {
  const input = populatedInput()
  const original = structuredClone(input)
  const circuit = fixedCopper()
  expect(input.connections).toHaveLength(50)
  expect(input.obstacles).toHaveLength(1577)
  const solver = solvePopulated(input)
  expect(input).toEqual(original)
  let caption = "FAILED   0/50 DDR signals accepted"
  if (solver.solved) {
    const traces = solver.getOutput().traces.map((trace) => {
      if (!trace.connection_name)
        throw Error("Completed trace has no connection name")
      return { ...trace, connection_name: trace.connection_name }
    })
    expect(traces.map((t) => t.connection_name).sort()).toEqual(
      input.connections.map((c) => c.name).sort(),
    )
    const physical = {
      ...original,
      obstacles: original.obstacles.map((o) => ({
        ...o,
        type: "rect" as const,
      })),
      traces: [],
    }
    const context = { inputSrj: physical, routedSrj: { ...physical, traces } }
    const connected = validateOriginalEndpointConnectivity(context)
    expect(connected.valid).toBe(true)
    expect(connected.connectedConnectionCount).toBe(50)
    expect(connected.connectedEndpointCount).toBe(100)
    expect(
      validateRoutedCopperDrc({
        ...context,
        clearance: input.minTraceToPadEdgeClearance!,
        allowBlindAndBuriedVias: false,
      }).issues,
    ).toEqual([])
    for (const trace of traces) {
      circuit.push(pcb_trace.parse(trace))
      for (const [index, p] of trace.route.entries()) {
        if (p.route_type !== "via") continue
        circuit.push(
          pcb_via.parse({
            type: "pcb_via",
            pcb_via_id: `ddr_${trace.connection_name}_via_${index}`,
            pcb_trace_id: trace.pcb_trace_id,
            x: p.x,
            y: p.y,
            layers: ["top", "inner1", "inner2", "bottom"],
            outer_diameter: p.via_diameter ?? input.minViaPadDiameter,
            hole_diameter: p.via_hole_diameter ?? input.minViaHoleDiameter,
          }),
        )
      }
    }
    caption = "50/50 DDR signals connected   Copper DRC passed"
  }
  function label(
    id: string,
    text: string,
    x: number,
    y: number,
    size: number,
  ): AnyCircuitElement {
    return {
      type: "pcb_note_text",
      pcb_note_text_id: id,
      pcb_group_id: "repro",
      text,
      anchor_position: { x, y },
      anchor_alignment: "center",
      font: "tscircuit2024",
      layer: "top",
      font_size: size,
    }
  }
  circuit.push(
    label("status", caption, -9, 28.5, 0.85),
    label("ram", "DDR3L", -20, 25.75, 0.75),
    label("cpu", "AM3354", 0.2, 25.75, 0.75),
  )
  if (!solver.solved) {
    for (const net of input.connections.filter((c) =>
      ["DDR_D0", "DDR_D8", "DDR_CK"].includes(c.name),
    )) {
      const [a, b] = net.pointsToConnect
      circuit.push({
        type: "pcb_note_line",
        pcb_note_line_id: net.name,
        pcb_group_id: "repro",
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke_width: 0.05,
        color: "#a4b0c8",
        is_dashed: true,
        layer: "top",
      })
    }
    circuit.push(
      label("guides", "Dashed endpoint guides   D0, D8 and CK", -9, 3.95, 0.55),
    )
  }
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1400,
      height: 920,
      viewport: { minX: -29, maxX: 11, minY: 3, maxY: 30.5 },
      showSolderMask: false,
      showSolderPaste: false,
      showPinNumbers: false,
      shouldDrawRatsNest: false,
      shouldDrawErrors: false,
      showErrorsInTextOverlay: false,
      includeVersion: false,
    },
  })
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
}, 280_000)
