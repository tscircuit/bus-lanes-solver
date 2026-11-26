import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { type AnyCircuitElement, pcb_trace, pcb_via } from "circuit-json"
import {
  BusLanesPipelineSolver,
  type Bus,
  type Connection,
  type SimpleRouteJson,
  type Terminal,
} from "../lib"
import {
  expandedSignalSiteChoices,
  expandedSignalSites,
} from "../lib/expanded-signal-sites"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"

/** Core lists the connections its later phases still have to route. */
type CoreRequest = SimpleRouteJson & {
  pendingRoutingAccess: { connections: Connection[]; buses?: Bus[] }[]
}
type Fixture = { request: CoreRequest; circuit: AnyCircuitElement[] }
type LaterSignal = {
  connection: Connection
  bottomCarrier: boolean
  sites: Terminal[]
}

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "./fixtures/h3-byte0-pending-buses/input.json.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8"),
) as Fixture

/** Whether a later byte signal can still use the bottom layer: the solver's
 * own expanded via sites at both pads, joined by a legal bottom-layer path.
 * The sites are returned for drawing. */
function getLaterSignals(
  input: SimpleRouteJson,
  laterBus: CoreRequest["pendingRoutingAccess"][number],
): LaterSignal[] {
  return laterBus.connections.map((connection) => {
    const request = { input, connection, targetLayer: "bottom" }
    const choices = expandedSignalSiteChoices(request)
    let step = choices.next()
    while (!step.done) step = choices.next()
    const sites = expandedSignalSites(request)
    let siteStep = sites.next()
    while (!siteStep.done) siteStep = sites.next()
    return {
      connection,
      bottomCarrier: step.value.length > 0,
      sites: siteStep.value.flat().map((site) => site.point),
    }
  })
}

function note({
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

function square({
  id,
  at,
  half,
  color,
  layer,
}: {
  id: string
  at: Terminal
  half: number
  color: string
  layer: "top" | "bottom"
}): AnyCircuitElement[] {
  const corners = [
    { x: at.x - half, y: at.y - half },
    { x: at.x + half, y: at.y - half },
    { x: at.x + half, y: at.y + half },
    { x: at.x - half, y: at.y + half },
  ]
  return corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length]!
    return {
      type: "pcb_note_line",
      pcb_note_line_id: `${id}_${index}`,
      layer,
      x1: corner.x,
      y1: corner.y,
      x2: next.x,
      y2: next.y,
      stroke_width: 0.04,
      color,
    }
  })
}

const svgOptions = {
  backgroundColor: "white",
  colorOverrides: { boardOutline: "#475569" },
  shouldDrawErrors: false,
  shouldDrawRatsNest: false,
  showErrorsInTextOverlay: false,
}

// Board coordinates in mm, +X right, +Y up. On this two-layer board the DDR3
// RAM is on the right and the H3 CPU on the left.
test("H3 byte 0 leaves later byte 1 signals without a bottom-layer carrier", async (): Promise<void> => {
  // Core's byte 0 request, with byte 1 and the remaining connections listed
  // as later phases. Core calls the solver without options.
  const input = fixture.request
  const original = structuredClone(input)
  expect(
    input.pendingRoutingAccess.map((access) => access.connections.length),
  ).toEqual([8, 37])
  const laterBus = input.pendingRoutingAccess[0]!
  expect(laterBus.buses?.map((bus) => bus.name)).toEqual(["DDR_BUS_byte1"])
  const before = getLaterSignals(input, laterBus)
  expect(before.filter((signal) => signal.bottomCarrier)).toHaveLength(8)

  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(input).toEqual(original)
  expectCompletedRouting(solver, original)
  const output = solver.getOutput()
  expect(output.traces).toHaveLength(8)

  const after = getLaterSignals(output, laterBus)
  const withoutBottomCarrier = after
    .filter((signal) => !signal.bottomCarrier)
    .map((signal) => signal.connection.name)
  expect(withoutBottomCarrier).toEqual([
    "source_net_29",
    "source_net_30",
    "source_net_31",
    "source_net_32",
    "source_net_40",
    "source_net_41",
  ])

  // Draw only byte 0's completed, validated copper. Later byte 1 requests
  // are dashed guides; squares are their bottom via sites, red where the
  // signal has no bottom-layer path between its two pads.
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
  const blocked = "#dc2626"
  const open = "#16a34a"
  for (const signal of after) {
    const color = signal.bottomCarrier ? open : blocked
    const [first, second] = signal.connection.pointsToConnect
    circuit.push({
      type: "pcb_note_line",
      pcb_note_line_id: `later_${signal.connection.name}`,
      layer: "top",
      x1: first!.x,
      y1: first!.y,
      x2: second!.x,
      y2: second!.y,
      stroke_width: 0.05,
      color,
      is_dashed: true,
    })
    for (const [index, site] of signal.sites.entries())
      circuit.push(
        ...square({
          id: `site_${signal.connection.name}_${index}`,
          at: site,
          half: 0.09,
          color,
          layer: "bottom",
        }),
      )
  }

  const board = fixture.circuit.find((element) => element.type === "pcb_board")
  if (!board || board.type !== "pcb_board" || !board.width || !board.height)
    throw Error("The native fixture must declare its PCB dimensions")
  const top = board.center.y + board.height / 2
  const status =
    `${withoutBottomCarrier.length} of 8 later byte 1 signals have no ` +
    "bottom-layer carrier (red)"
  const scope =
    "8 completed byte 0 routes validated; dashed lines are later requests, " +
    "squares their bottom via sites"
  await expect([
    ...circuit,
    note({
      id: "status_board",
      text: status,
      x: board.center.x,
      y: top + 2.2,
      fontSize: 0.47,
    }),
    note({
      id: "scope_board",
      text: scope,
      x: board.center.x,
      y: top + 1.25,
      fontSize: 0.32,
    }),
  ]).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "pcb",
    svgOptions: {
      ...svgOptions,
      width: 1600,
      height: 1100,
      viewport: {
        minX: board.center.x - board.width / 2 - 1.5,
        maxX: board.center.x + board.width / 2 + 1.5,
        minY: board.center.y - board.height / 2 - 1.5,
        maxY: top + 3.3,
      },
    },
  })
  await expect([
    ...circuit,
    note({ id: "status_detail", text: status, x: 2, y: 6.5, fontSize: 0.22 }),
    note({ id: "scope_detail", text: scope, x: 2, y: 6.1, fontSize: 0.16 }),
  ]).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "detail",
    svgOptions: {
      ...svgOptions,
      width: 1600,
      height: 1100,
      viewport: { minX: -7, maxX: 11, minY: -3.5, maxY: 6.9 },
    },
  })
}, 900_000)
