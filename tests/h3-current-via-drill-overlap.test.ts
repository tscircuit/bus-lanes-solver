import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkViasInPads } from "@tscircuit/checks"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { type AnyCircuitElement, pcb_trace, pcb_via } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  BusLanesPipelineSolver,
  type Connection,
  type SimpleRouteJson,
} from "../lib"
import { expectConnectedAndClear } from "./fixtures/expect-connected-and-clear"

const fixtureDirectory = new URL(
  "./fixtures/h3-current-via-drill-overlap/",
  import.meta.url,
)
const provenance = JSON.parse(
  readFileSync(new URL("provenance.json", fixtureDirectory), "utf8"),
)
const readFixture = (name: string) => {
  const bytes = readFileSync(new URL(name, fixtureDirectory))
  const record = provenance.files.find(
    (file: { path: string }) => file.path === name,
  )
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(record.sha256)
  return name.endsWith(".gz") ? gunzipSync(bytes) : bytes
}
const native = JSON.parse(
  readFixture("native-circuit.json.gz").toString(),
) as AnyCircuitElement[]
const input = JSON.parse(
  readFixture("input.json.gz").toString(),
) as SimpleRouteJson
const fixedConnections = JSON.parse(
  readFixture("fixed-connections.json").toString(),
) as Connection[]
type Pad = Extract<AnyCircuitElement, { type: "pcb_smtpad" }>
type Via = Extract<AnyCircuitElement, { type: "pcb_via" }>

function note(options: {
  id: string
  text: string
  x: number
  y: number
  size: number
}): AnyCircuitElement {
  return {
    type: "pcb_note_text",
    pcb_note_text_id: options.id,
    pcb_group_id: "via_drill_status",
    text: options.text,
    anchor_position: { x: options.x, y: options.y },
    font: "tscircuit2024",
    layer: "top",
    font_size: options.size,
    anchor_alignment: "center",
  }
}

function marker(options: {
  id: string
  x: number
  y: number
  half: number
}): AnyCircuitElement[] {
  const { x, y, half, id } = options
  const corners = [
    { x: x - half, y: y - half },
    { x: x + half, y: y - half },
    { x: x + half, y: y + half },
    { x: x - half, y: y + half },
  ]
  return corners.map((point, index) => ({
    type: "pcb_note_line",
    pcb_note_line_id: id + "_" + index,
    layer: "top",
    x1: point.x,
    y1: point.y,
    x2: corners[(index + 1) % 4].x,
    y2: corners[(index + 1) % 4].y,
    color: "#d97706",
    stroke_width: 0.035,
  }))
}

function padLabel(pad: Pad): string {
  const port = native.find(
    (element) =>
      element.type === "pcb_port" && element.pcb_port_id === pad.pcb_port_id,
  )
  const sourcePort =
    port?.type === "pcb_port"
      ? native.find(
          (element) =>
            element.type === "source_port" &&
            element.source_port_id === port.source_port_id,
        )
      : undefined
  const component = native.find(
    (element) =>
      element.type === "pcb_component" &&
      element.pcb_component_id === pad.pcb_component_id,
  )
  const source =
    component?.type === "pcb_component"
      ? native.find(
          (element) =>
            element.type === "source_component" &&
            element.source_component_id === component.source_component_id,
        )
      : undefined
  return [
    source?.type === "source_component" ? source.name : "Native pad",
    sourcePort?.type === "source_port" ? sourcePort.name : pad.port_hints?.[0],
  ]
    .filter(Boolean)
    .join(" / ")
}

// This user-requested reproduction intentionally records solver-accepted
// copper with a clearly labeled manufacturing failure. It is not DRC clean.
test("native H3 byte one accepts three forbidden own-pad drill overlaps", async () => {
  const original = structuredClone(input)
  const pads = native.filter(
    (element): element is Pad => element.type === "pcb_smtpad",
  )
  expect(pads).toHaveLength(445)
  expect(input.obstacles).toHaveLength(445)
  expect(input.allowViaInPad).toBe(false)
  expect(input.traces).toHaveLength(8)
  expect(input.connections).toHaveLength(8)
  const solver = new BusLanesPipelineSolver(input)
  const deadline = performance.now() + 300_000
  let observedSteps = 0
  while (!solver.solved && !solver.failed && performance.now() < deadline) {
    solver.step()
    if (++observedSteps % 2048 === 0) await Bun.sleep(0)
  }
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutput().traces
  expect(traces).toHaveLength(16)
  expect(traces.slice(0, 8)).toEqual(original.traces!)
  // These existing checks establish current connectivity and foreign-copper
  // clearance. The independent manufacturing check below exposes the issue.
  expectConnectedAndClear({
    request: input,
    connections: [...fixedConnections, ...input.connections],
    traces,
  })
  expect(
    solver.getPendingRoutingAccessReport()?.newlyBlockedConnectionNames,
  ).toEqual([])
  expect(solver.getPendingRoutingAccessReport()?.declaredTerminalCount).toBe(76)
  expect(input).toEqual(original)

  const circuit = [...native]
  const vias: Via[] = []
  for (const trace of traces) {
    circuit.push(pcb_trace.parse(trace))
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type !== "via") continue
      const via = pcb_via.parse({
        type: "pcb_via",
        pcb_via_id: `${trace.pcb_trace_id}_via_${index}`,
        pcb_trace_id: trace.pcb_trace_id,
        x: point.x,
        y: point.y,
        outer_diameter: point.via_diameter ?? input.minViaPadDiameter,
        hole_diameter: point.via_hole_diameter ?? input.minViaHoleDiameter,
        layers: point.layers ?? getCopperLayerNames(input.layerCount),
      })
      vias.push(via)
      circuit.push(via)
    }
  }
  const errors = checkViasInPads(circuit)
  expect(errors).toHaveLength(3)
  const errorIds = new Set(errors.map((error) => error.pcb_placement_error_id))
  const violations = vias.flatMap((via) =>
    pads.flatMap((pad) => {
      if (!errorIds.has(`via_in_pad_${via.pcb_via_id}_${pad.pcb_smtpad_id}`))
        return []
      // Every native pad involved in this captured failure is explicitly a
      // circle. The signed drill gap is exact, not an obstacle-AABB estimate.
      if (pad.shape !== "circle")
        throw Error("Expected the captured native circular pad")
      return [
        {
          via,
          pad,
          gap:
            Math.hypot(via.x - pad.x, via.y - pad.y) -
            via.hole_diameter / 2 -
            pad.radius,
        },
      ]
    }),
  )
  expect(violations).toHaveLength(errors.length)
  expect(violations.map((pair) => pair.pad.pcb_smtpad_id).sort()).toEqual([
    "pcb_smtpad_10",
    "pcb_smtpad_14",
    "pcb_smtpad_312",
  ])
  expect(violations.every((pair) => pair.gap < -1e-9)).toBe(true)
  for (const pair of violations)
    circuit.push(
      ...marker({
        id: "drill_overlap_" + pair.pad.pcb_smtpad_id,
        x: pair.pad.x,
        y: pair.pad.y,
        half: pair.pad.shape === "circle" ? pair.pad.radius + 0.18 : 0.4,
      }),
    )

  const board = native.find((element) => element.type === "pcb_board")
  if (!board || board.width === undefined || board.height === undefined)
    throw Error("Native board dimensions required")
  const bounds = {
    minX: board.center.x - board.width / 2,
    maxX: board.center.x + board.width / 2,
    minY: board.center.y - board.height / 2,
    maxY: board.center.y + board.height / 2,
  }
  const pending = input.pendingRoutingAccess!.flatMap(
    (phase) => phase.connections,
  )
  const requestGuides: AnyCircuitElement[] = pending.flatMap((connection) =>
    connection.pointsToConnect.slice(1).map((point, index) => ({
      type: "pcb_note_line",
      pcb_note_line_id: "later_" + connection.name + "_" + index,
      layer: "top",
      x1: connection.pointsToConnect[0].x,
      y1: connection.pointsToConnect[0].y,
      x2: point.x,
      y2: point.y,
      color: "#80a595",
      stroke_width: 0.02,
      is_dashed: true,
    })),
  )
  const svgOptions = {
    backgroundColor: "white",
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    showErrorsInTextOverlay: false,
    showDebugObjects: false,
    colorOverrides: { boardOutline: "#475569" },
  }
  await expect([
    ...circuit,
    ...requestGuides,
    note({
      id: "repro_title",
      text: "Repro: solver accepts 3 forbidden via drills inside own pads",
      x: board.center.x,
      y: bounds.maxY + 2.7,
      size: 0.58,
    }),
    note({
      id: "repro_scope",
      text: "16 connected current routes; 8 supplied routes unchanged; 37 later nets pending. Via-in-pad DRC FAILS.",
      x: board.center.x,
      y: bounds.maxY + 1.9,
      size: 0.38,
    }),
    note({
      id: "repro_legend",
      text: "Red/blue: actual copper. Orange boxes: forbidden drill/pad overlap. Green dashed: pending, unrouted requests.",
      x: board.center.x,
      y: bounds.maxY + 1.1,
      size: 0.33,
    }),
  ]).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      ...svgOptions,
      width: 1600,
      height: 1100,
      viewport: {
        minX: bounds.minX - 1,
        maxX: bounds.maxX + 1,
        minY: bounds.minY - 1,
        maxY: bounds.maxY + 3.7,
      },
    },
  })

  for (const pair of violations) {
    const label = padLabel(pair.pad)
    const detail = convertCircuitJsonToPcbSvg(circuit, {
      ...svgOptions,
      width: 900,
      height: 900,
      viewport: {
        minX: pair.pad.x - 0.8,
        maxX: pair.pad.x + 0.8,
        minY: pair.pad.y - 0.8,
        maxY: pair.pad.y + 0.8,
      },
    })
    // Reserve separate white header/footer rows. Captions never cover native
    // pads or manufactured copper, including neighboring balls of this BGA.
    const escapeXml = (text: string) =>
      text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100" viewBox="0 0 900 1100">
      <rect width="900" height="1100" fill="white"/>
      <text x="450" y="42" text-anchor="middle" font-family="sans-serif" font-size="25">${escapeXml(label)}: forbidden via drill overlap</text>
      <text x="450" y="82" text-anchor="middle" font-family="sans-serif" font-size="22">Signed drill-to-pad gap: ${pair.gap.toFixed(5)} mm; allowViaInPad = false</text>
      <g transform="translate(0,120)">${detail.replace(/^<\?xml[^>]*>\s*/, "")}</g>
      <text x="450" y="1060" text-anchor="middle" font-family="sans-serif" font-size="19">Copper annulus may join its own pad; the drill must stay outside.</text>
    </svg>`
    await expect(svg).toMatchSvgSnapshot(
      import.meta.path,
      pair.pad.pcb_smtpad_id,
    )
  }
}, 360_000)
