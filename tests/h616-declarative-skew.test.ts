import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type AnyCircuitElement, pcb_trace, pcb_via } from "circuit-json"
import {
  getCopperLayerNames,
  getRouteViaSpanLayers,
} from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import {
  expectH616Routing,
  type H616Fixture,
} from "./fixtures/expect-h616-routing"

test("Core's unchanged H616 TSX input solves in one phase with default options", async () => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-reference-skew/declarative.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const reference: H616Fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-reference-skew/unrouted.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const circuit: AnyCircuitElement[] = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-reference-skew/unrouted.circuit.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const before = structuredClone(input)
  expect(input.traces).toHaveLength(0)
  expect(input.connections).toHaveLength(53)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(input).toEqual(before)
  let caption = "FAILED BASELINE: no accepted routing for 53 H616 DDR signals"
  if (solver.solved) {
    expectH616Routing({
      input,
      generated: solver.traces,
      clockBuses: input.buses ?? [],
      constraints: reference.constraints,
      preservation: reference.preservation,
    })
    circuit.push(...solver.traces.map((trace) => pcb_trace.parse(trace)))
    for (const trace of solver.traces)
      for (const [index, point] of trace.route.entries())
        if (point.route_type === "via")
          circuit.push(
            pcb_via.parse({
              type: "pcb_via",
              pcb_via_id: `${trace.pcb_trace_id}_via_${index}`,
              pcb_trace_id: trace.pcb_trace_id,
              x: point.x,
              y: point.y,
              outer_diameter: point.via_diameter,
              hole_diameter: point.via_hole_diameter,
              layers: getRouteViaSpanLayers({
                fromLayer: point.from_layer,
                toLayer: point.to_layer,
                layers: point.layers,
                layerNames: getCopperLayerNames(input.layerCount),
                allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
              }),
            }),
          )
    caption = "53/53 connected; 9/9 skew rules; 6/6 preserved; DRC passed"
  }
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "routing_status",
    pcb_group_id: "routing_status",
    text: caption,
    anchor_position: { x: 1, y: 19.4 },
    font: "tscircuit2024",
    layer: "top",
    font_size: 0.42,
    anchor_alignment: "center",
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1200,
      height: 1000,
      viewport: { minX: -10.5, maxX: 12.5, minY: 1, maxY: 20.5 },
      shouldDrawRatsNest: false,
      showDebugObjects: false,
    },
  })
  expect(solver.solved, solver.error ?? undefined).toBe(true)
}, 130000)
