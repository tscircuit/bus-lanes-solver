import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { type AnyCircuitElement, pcb_trace, pcb_via } from "circuit-json"
import {
  BusLanesPipelineSolver,
  type Connection,
  type SimpleRouteJson,
} from "../lib"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"
import { getPadEscape } from "./fixtures/pad-escapes"

type Fixture = {
  ramByte0Request: SimpleRouteJson
  ramByte1Request: SimpleRouteJson
  fixedConnections: Connection[]
  maskConnections: Connection[]
  circuit: AnyCircuitElement[]
}

test("A13 RAM bytes retain both pending data-mask escapes", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/a13-pending-mask-access/input.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  ) as Fixture
  const first = new BusLanesPipelineSolver(fixture.ramByte0Request, {
    singleCarrier: { fixedConnections: fixture.fixedConnections },
  })
  first.solve()
  expectCompletedRouting(first, fixture.ramByte0Request)

  const secondRequest = {
    ...fixture.ramByte1Request,
    traces: first.getOutput().traces,
  }
  const second = new BusLanesPipelineSolver(secondRequest, {
    singleCarrier: {
      fixedConnections: [
        ...fixture.fixedConnections,
        ...fixture.ramByte0Request.connections,
      ],
    },
  })
  second.solve()
  expectCompletedRouting(second, secondRequest)
  const output = second.getOutput()
  expect(output.traces).toHaveLength(32)

  const ramMaskPads = fixture.maskConnections.map((connection) => {
    const end = connection.pointsToConnect.findIndex((point) => point.x < 0)
    return getPadEscape({
      input: output,
      connection,
      end,
      viaTargetLayer: "bottom",
    })
  })
  const accessibleMaskPads = ramMaskPads.filter(Boolean).length
  expect(accessibleMaskPads).toBe(2)

  const circuit = [...fixture.circuit]
  const layers = getCopperLayerNames(output.layerCount)
  for (const trace of output.traces) {
    circuit.push(pcb_trace.parse(trace))
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type !== "via") continue
      circuit.push(
        pcb_via.parse({
          type: "pcb_via",
          pcb_via_id: `${trace.pcb_trace_id}_via_${index}`,
          pcb_trace_id: trace.pcb_trace_id,
          x: point.x,
          y: point.y,
          outer_diameter: point.via_diameter ?? output.minViaPadDiameter,
          hole_diameter: point.via_hole_diameter ?? output.minViaHoleDiameter,
          layers,
        }),
      )
    }
  }
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "pending_mask_status",
    pcb_group_id: "pending_mask_status",
    anchor_position: { x: -4.1, y: 5.2 },
    text: `32/32 data paths; DRC passed; DM escapes: ${accessibleMaskPads}/2`,
    font: "tscircuit2024",
    layer: "top",
    font_size: 0.18,
    anchor_alignment: "center",
  })
  for (const [index, connection] of fixture.maskConnections.entries()) {
    const pad = connection.pointsToConnect.find((point) => point.x < 0)!
    circuit.push({
      type: "pcb_note_text",
      pcb_note_text_id: `mask_${index}`,
      text: ["DM0 (E7)", "DM1 (D3)"][index],
      anchor_position: { x: pad.x, y: pad.y + 0.25 },
      anchor_alignment: "bottom_left",
      font: "tscircuit2024",
      layer: "top",
      font_size: 0.17,
    })
  }
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      backgroundColor: "white",
      shouldDrawErrors: false,
      shouldDrawRatsNest: false,
      showErrorsInTextOverlay: false,
      width: 1000,
      height: 750,
      viewport: { minX: -7.6, maxX: -0.6, minY: 0, maxY: 5.5 },
    },
  })
}, 900_000)
