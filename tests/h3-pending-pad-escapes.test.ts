import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type AnyCircuitElement, pcb_trace, pcb_via } from "circuit-json"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import {
  BusLanesPipelineSolver,
  type Connection,
  type PendingRoutingAccess,
  type SimpleRouteJson,
} from "../lib"
import { expectConnectedAndClear } from "./fixtures/expect-connected-and-clear"
import { type PadEscape, getPadEscape } from "./fixtures/pad-escapes"
import { auditPendingWitnesses } from "./fixtures/pending-access-certificates"

type Fixture = {
  byte1Request: SimpleRouteJson
  fixedConnections: Connection[]
  pendingConnections: Connection[]
  circuit: AnyCircuitElement[]
}

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "./fixtures/h3-pending-pad-escapes/input.json.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8"),
) as Fixture

// Projected from the captured native remaining phase; its own physical rules
// are documented beside this file. The original byte1 fixture is unchanged.
const pendingRoutingAccess = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/h3-pending-pad-escapes/pending-routing-access.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as PendingRoutingAccess[]

type PendingPad = { pcbPortId: string; escape: PadEscape }

/** Historical finite samples retained for comparison, not acceptance. A
 * missing sample is not proof that a native terminal has lost access. */
function getPendingPads(input: SimpleRouteJson): PendingPad[] {
  return input.pendingRoutingAccess!.flatMap((intent) =>
    intent.connections.flatMap((connection) =>
      connection.pointsToConnect.map((point, end) => ({
        pcbPortId: point.pcb_port_id!,
        escape: getPadEscape({
          input: {
            ...intent,
            layerCount: input.layerCount,
            obstacles: input.obstacles,
            traces: input.traces,
          },
          connection,
          end,
          viaTargetLayer: "bottom",
        }),
      })),
    ),
  )
}

function statusNote({
  id,
  text,
  x,
  y,
  fontSize,
}: {
  id: string
  text: string
  x: number
  y: number
  fontSize: number
}): AnyCircuitElement {
  return {
    type: "pcb_note_text",
    pcb_note_text_id: id,
    pcb_group_id: "routing_status",
    text,
    anchor_position: { x, y },
    font: "tscircuit2024",
    layer: "top",
    font_size: fontSize,
    anchor_alignment: "center",
  }
}

const svgOptions = {
  backgroundColor: "white",
  colorOverrides: { boardOutline: "#475569" },
  shouldDrawErrors: false,
  shouldDrawRatsNest: false,
  showErrorsInTextOverlay: false,
}

// Board coordinates in mm, +X right, +Y up. The H3 CPU is on the left and the
// DDR3 RAM on the right of this two-layer board.
test("H3 byte 1 preserves access to every declared later terminal", async (): Promise<void> => {
  // Core hands each phase request to the solver without options.
  const input = { ...fixture.byte1Request, pendingRoutingAccess }
  expect(pendingRoutingAccess.flatMap((intent) => intent.connections)).toEqual(
    fixture.pendingConnections,
  )
  const original = structuredClone(input)
  const beforeCertificates = auditPendingWitnesses({
    input,
    traces: input.traces ?? [],
    fixedConnections: fixture.fixedConnections,
  })
  expect(beforeCertificates.terminalCount).toBe(76)
  expect(beforeCertificates.reports.filter((report) => !report.valid)).toEqual(
    [],
  )
  const solver = new BusLanesPipelineSolver(input)
  // Supervise default-options stepping with the benchmark's observation
  // deadline. An unfinished solve fails before any snapshot is exported.
  const started = performance.now()
  const deadline = started + 300_000
  let observedSteps = 0
  while (!solver.solved && !solver.failed && performance.now() < deadline) {
    solver.step()
    if (++observedSteps % 2_048 === 0) await Bun.sleep(0)
  }
  expect(input).toEqual(original)
  if (!solver.solved && !solver.failed)
    throw Error(
      "Native H3 routing is unresolved after the 300-second observation deadline",
    )
  const nativeElapsedMs = performance.now() - started
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.getPendingRoutingAccessReport()).toEqual({
    outcome: "preserved",
    declaredConnectionCount: 37,
    declaredTerminalCount: 76,
    framedTerminalCount: 76,
    baselineAccessibleFramedTerminalCount: 76,
    baselineInaccessibleFramedTerminalCount: 0,
    peerConnectionCount: 0,
    validatedTraceCount: 16,
    newlyBlockedConnectionNames: [],
  })
  const traces = solver.getOutput().traces
  expect(traces).toHaveLength(16)
  expect(traces.slice(0, 8)).toEqual(original.traces!)
  expectConnectedAndClear({
    request: input,
    connections: [...fixture.fixedConnections, ...input.connections],
    traces,
  })

  const afterCertificates = auditPendingWitnesses({
    input,
    traces,
    fixedConnections: fixture.fixedConnections,
  })
  expect(afterCertificates.terminalCount).toBe(76)
  expect(afterCertificates.validCount).toBe(76)
  expect(afterCertificates.reports.filter((report) => !report.valid)).toEqual(
    [],
  )

  // Independently checked concrete witnesses decide access. Each witness
  // belongs to its own future phase's geometry/rules; future nets are not
  // claimed to have been routed together by this necessary-access check.
  expect(
    beforeCertificates.reports.every(
      (report) => typeof report.pcbPortId === "string",
    ),
  ).toBe(true)
  const beforeByPortId = new Map(
    beforeCertificates.reports.map((report) => [report.pcbPortId!, report]),
  )
  expect(beforeByPortId.size).toBe(76)
  const after = getPendingPads({ ...input, traces })
  expect(after).toHaveLength(76)
  const trappedPorts = afterCertificates.reports
    .filter(
      (report) => beforeByPortId.get(report.pcbPortId!)!.valid && !report.valid,
    )
    .map((report) => report.pcbPortId!)
  const alreadyInaccessiblePorts = afterCertificates.reports
    .filter(
      (report) =>
        !beforeByPortId.get(report.pcbPortId!)!.valid && !report.valid,
    )
    .map((report) => report.pcbPortId!)
  const initiallyInaccessiblePorts = beforeCertificates.reports
    .filter((report) => !report.valid)
    .map((report) => report.pcbPortId!)
  const legacySampling = {
    afterMissing: after.filter((pad) => !pad.escape).length,
  }

  expect(initiallyInaccessiblePorts).toEqual([])
  expect(trappedPorts).toEqual([])
  expect(alreadyInaccessiblePorts).toEqual([])
  expect(input).toEqual(original)
  // Optional local evidence export is gated by the complete physical checks
  // above. It never supplies saved routes to the solver or snapshot exporter.
  if (process.env.H3_ACCEPTED_OUTPUT_PATH)
    writeFileSync(
      process.env.H3_ACCEPTED_OUTPUT_PATH,
      JSON.stringify(
        {
          schemaVersion: 1,
          qualification:
            "Fresh byte-one solve: sixteen current routes completed; thirty-seven later connections remain pending. Individual access witnesses do not prove simultaneous future routing.",
          acceptedOutputValidated: true,
          input,
          output: solver.getOutput(),
          nativeSolve: {
            elapsedMs: nativeElapsedMs,
            iterations: solver.iterations,
          },
          pendingRoutingAccessReport: solver.getPendingRoutingAccessReport(),
          certificateAudit: afterCertificates,
          legacySampling,
        },
        null,
        2,
      ),
    )

  // All 16 copper routes are completed and validated. Green boxes mark
  // certified terminals; dashed guides and access witnesses are note overlays.
  const circuit = [...fixture.circuit]
  const layers = getCopperLayerNames(input.layerCount)
  for (const trace of traces) {
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
          outer_diameter: point.via_diameter ?? input.minViaPadDiameter,
          hole_diameter: point.via_hole_diameter ?? input.minViaHoleDiameter,
          layers: point.layers ?? layers,
        }),
      )
    }
  }

  const newlyTrapped = new Set(trappedPorts)
  const alreadyInaccessible = new Set(alreadyInaccessiblePorts)
  const newColor = "#1d4ed8"
  const existingColor = "#b45309"
  const accessibleColor = "#047857"
  for (const connection of fixture.pendingConnections) {
    const unavailablePads = connection.pointsToConnect.filter(
      (pad) =>
        newlyTrapped.has(pad.pcb_port_id!) ||
        alreadyInaccessible.has(pad.pcb_port_id!),
    )
    const guideColor = unavailablePads.some((pad) =>
      newlyTrapped.has(pad.pcb_port_id!),
    )
      ? newColor
      : unavailablePads.length
        ? existingColor
        : "#6fa58f"
    const first = connection.pointsToConnect[0]
    // Include every branch of native multi-terminal nets, including their
    // bottom-layer resistor terminals.
    for (const [index, point] of connection.pointsToConnect.entries()) {
      if (!index) continue
      circuit.push({
        type: "pcb_note_line",
        pcb_note_line_id: "pending_" + connection.name + "_" + index,
        layer: "top",
        x1: first.x,
        y1: first.y,
        x2: point.x,
        y2: point.y,
        stroke_width: 0.035,
        color: guideColor,
        is_dashed: true,
      })
    }
    for (const pad of connection.pointsToConnect) {
      const half = 0.26
      const corners = [
        { x: pad.x - half, y: pad.y - half },
        { x: pad.x + half, y: pad.y - half },
        { x: pad.x + half, y: pad.y + half },
        { x: pad.x - half, y: pad.y + half },
      ]
      for (const [index, corner] of corners.entries()) {
        const next = corners[(index + 1) % corners.length]
        circuit.push({
          type: "pcb_note_line",
          pcb_note_line_id: "pending_access_" + pad.pcb_port_id + "_" + index,
          layer: "top",
          x1: corner.x,
          y1: corner.y,
          x2: next.x,
          y2: next.y,
          stroke_width: 0.06,
          color: newlyTrapped.has(pad.pcb_port_id!)
            ? newColor
            : alreadyInaccessible.has(pad.pcb_port_id!)
              ? existingColor
              : accessibleColor,
        })
      }
    }
  }

  // Show the concrete access paths missed by the legacy finite sampler.
  // These are explicitly dashed note overlays, never future routed copper.
  const legacyMisses = new Set(
    after.filter((pad) => !pad.escape).map((pad) => pad.pcbPortId),
  )
  for (const report of afterCertificates.reports) {
    if (!report.pcbPortId || !legacyMisses.has(report.pcbPortId)) continue
    const path = report.witness!.path
    for (let index = 1; index < path.length; index++)
      circuit.push({
        type: "pcb_note_line",
        pcb_note_line_id: "access_witness_" + report.pcbPortId + "_" + index,
        layer: "top",
        x1: path[index - 1].x,
        y1: path[index - 1].y,
        x2: path[index].x,
        y2: path[index].y,
        stroke_width: 0.04,
        color: "#0284c7",
        is_dashed: true,
      })
    const end = path.at(-1)!
    for (const [axis, delta] of [
      { x: 0.08, y: 0 },
      { x: 0, y: 0.08 },
    ].entries())
      circuit.push({
        type: "pcb_note_line",
        pcb_note_line_id: "access_exit_" + report.pcbPortId + "_" + axis,
        layer: "top",
        x1: end.x - delta.x,
        y1: end.y - delta.y,
        x2: end.x + delta.x,
        y2: end.y + delta.y,
        stroke_width: 0.04,
        color: "#0284c7",
      })
  }

  // Label native top-side packages at their actual component bounds.
  for (const element of fixture.circuit) {
    if (element.type !== "pcb_component" || element.layer !== "top") continue
    const source = fixture.circuit.find(
      (candidate) =>
        candidate.type === "source_component" &&
        candidate.source_component_id === element.source_component_id,
    )
    if (!source || source.type !== "source_component") continue
    circuit.push(
      statusNote({
        id: "package_" + element.pcb_component_id,
        text: [source.name, source.manufacturer_part_number]
          .filter(Boolean)
          .join(" / "),
        x: element.center.x,
        y: element.center.y + element.height / 2 + 0.7,
        fontSize: 0.45,
      }),
    )
  }

  const board = fixture.circuit.find((element) => element.type === "pcb_board")
  if (
    !board ||
    board.width === undefined ||
    board.height === undefined ||
    !Number.isFinite(board.width) ||
    !Number.isFinite(board.height) ||
    board.width <= 0 ||
    board.height <= 0
  ) {
    throw Error(
      "The native fixture must declare finite positive PCB dimensions",
    )
  }
  const boardBounds = {
    minX: board.center.x - board.width / 2,
    maxX: board.center.x + board.width / 2,
    minY: board.center.y - board.height / 2,
    maxY: board.center.y + board.height / 2,
  }
  const title =
    "Future access preserved: 76/76 terminals have validated witnesses"
  const scope =
    "16/16 current connections; DRC clear; 37 later connections remain pending."
  const metric =
    "Legacy finite sampling misses " +
    legacySampling.afterMissing +
    " exits; cyan witnesses validate those exits (not routed nets)."
  const legend =
    "Red/blue: actual copper. Green boxes: validated access. Green dashed: 37 pending, unrouted requests."
  const fullCircuit = [
    ...circuit,
    statusNote({
      id: "routing_status_board",
      text: title,
      x: board.center.x,
      y: boardBounds.maxY + 3.4,
      fontSize: 0.58,
    }),
    statusNote({
      id: "routing_scope_board",
      text: scope,
      x: board.center.x,
      y: boardBounds.maxY + 2.6,
      fontSize: 0.42,
    }),
    statusNote({
      id: "routing_legend_board",
      text: legend,
      x: board.center.x,
      y: boardBounds.maxY + 1.8,
      fontSize: 0.32,
    }),
    statusNote({
      id: "routing_sampling_board",
      text: metric,
      x: board.center.x,
      y: boardBounds.maxY + 1.0,
      fontSize: 0.32,
    }),
  ]
  const fullOptions = {
    ...svgOptions,
    width: 1600,
    height: 1100,
    viewport: {
      minX: boardBounds.minX - 1.5,
      maxX: boardBounds.maxX + 1.5,
      minY: boardBounds.minY - 1.5,
      maxY: boardBounds.maxY + 4.3,
    },
  }
  // Derive the CPU zoom from the native package with the most pads. The old
  // hardcoded crop omitted part of this BGA and put captions over real pads.
  const cpu = fixture.circuit
    .filter((element) => element.type === "pcb_component")
    .map((component) => ({
      component,
      pads: input.obstacles.filter(
        (pad) => pad.componentId === component.pcb_component_id,
      ),
    }))
    .sort((first, second) => second.pads.length - first.pads.length)[0]
  if (!cpu?.pads.length)
    throw Error("The native CPU package must have original pad geometry")
  const cpuBounds = cpu.pads.map((pad) => {
    const angle = ((pad.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const halfWidth =
      pad.shape === "circle"
        ? pad.width / 2
        : (Math.abs(Math.cos(angle)) * pad.width +
            Math.abs(Math.sin(angle)) * pad.height) /
          2
    const halfHeight =
      pad.shape === "circle"
        ? pad.width / 2
        : (Math.abs(Math.sin(angle)) * pad.width +
            Math.abs(Math.cos(angle)) * pad.height) /
          2
    return {
      minX: pad.center.x - halfWidth,
      maxX: pad.center.x + halfWidth,
      minY: pad.center.y - halfHeight,
      maxY: pad.center.y + halfHeight,
    }
  })
  const cpuBox = {
    minX: Math.min(...cpuBounds.map((box) => box.minX)),
    maxX: Math.max(...cpuBounds.map((box) => box.maxX)),
    minY: Math.min(...cpuBounds.map((box) => box.minY)),
    maxY: Math.max(...cpuBounds.map((box) => box.maxY)),
  }
  const cpuCenterX = (cpuBox.minX + cpuBox.maxX) / 2
  const cpuSpan = Math.max(
    cpuBox.maxX - cpuBox.minX + 1.4,
    cpuBox.maxY - cpuBox.minY + 3,
  )
  const cpuSource = fixture.circuit.find(
    (element) =>
      element.type === "source_component" &&
      element.source_component_id === cpu.component.source_component_id,
  )
  const cpuLabel =
    cpuSource?.type === "source_component"
      ? [cpuSource.name, cpuSource.manufacturer_part_number]
          .filter(Boolean)
          .join(" / ")
      : "CPU"
  const cpuCircuit = [
    ...circuit.filter(
      (element) =>
        !(
          element.type === "pcb_note_text" &&
          element.pcb_note_text_id ===
            "package_" + cpu.component.pcb_component_id
        ),
    ),
    statusNote({
      id: "routing_status_cpu",
      text: cpuLabel + " — 76/76 future accesses validated",
      x: cpuCenterX,
      y: cpuBox.maxY + 1.9,
      fontSize: 0.2,
    }),
    statusNote({
      id: "routing_scope_cpu",
      text: "16 connected; DRC clear; 37 later nets pending",
      x: cpuCenterX,
      y: cpuBox.maxY + 1.45,
      fontSize: 0.17,
    }),
    statusNote({
      id: "routing_legend_cpu",
      text: "Red/blue: copper. Green dashed: pending requests. Green boxes: access.",
      x: cpuCenterX,
      y: cpuBox.maxY + 1.0,
      fontSize: 0.16,
    }),
    statusNote({
      id: "routing_sampling_cpu",
      text:
        "Cyan: " +
        legacySampling.afterMissing +
        " verified exits missed by sampling; not routed nets.",
      x: cpuCenterX,
      y: cpuBox.maxY + 0.55,
      fontSize: 0.16,
    }),
  ]
  const cpuOptions = {
    ...svgOptions,
    width: 1400,
    height: 1400,
    viewport: {
      minX: cpuCenterX - cpuSpan / 2,
      maxX: cpuCenterX + cpuSpan / 2,
      minY: cpuBox.minY - 0.7,
      maxY: cpuBox.minY - 0.7 + cpuSpan,
    },
  }

  // Snapshot only the completed, validated copper and labeled request guides.
  await expect(fullCircuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: fullOptions,
  })
  await expect(cpuCircuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "cpu",
    svgOptions: cpuOptions,
  })
}, 360_000)
