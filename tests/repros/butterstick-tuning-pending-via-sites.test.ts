import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  BusLanesPipelineSolver,
  BusLanesSolver,
  busLengthReports,
  type Connection,
  type SimpleRouteJson,
} from "../../lib"
import { getConnectedPadGroups } from "../../lib/connected-pad-groups"
import type { Obstacle } from "../../lib/types"
import { nativeValidationSrj } from "../fixtures/expect-completed-routing"
import { getPadEscape } from "../fixtures/pad-escapes"

type PortPad = Obstacle & { circuitJsonMetadata?: { pcb_port_id?: string } }
type PendingPad = { pad: PortPad; net: string; connection: Connection }

// ButterStick DDR3, Core's `matching` attempt: the request Core hands to the
// solver for the U11 address/command bus, with both completed byte phases
// supplied as traces. Board coordinates in mm, +X right, +Y up. The ECP5 is
// on the left, U11 (RAM0) top right and the second RAM bottom right.
const fixtureUrl = (name: string): URL =>
  new URL(
    `../fixtures/butterstick-address-command-tuning/${name}`,
    import.meta.url,
  )
const input = JSON.parse(
  gunzipSync(readFileSync(fixtureUrl("input.srj.json.gz"))).toString(),
) as SimpleRouteJson
const fixedConnections = JSON.parse(
  readFileSync(fixtureUrl("fixed-connections.json"), "utf8"),
) as Connection[]

/** Native pads of nets that join at least two ports but that this request
 * neither routes nor receives as copper: the remaining phase routes them. */
function getPendingPads(request: SimpleRouteJson): PendingPad[] {
  const assigned = new Set([
    ...request.connections.map((connection) => connection.name),
    ...request.traces!.map((trace) => trace.connection_name),
  ])
  return getConnectedPadGroups(
    request.obstacles.filter((pad) => pad.componentId),
  ).flatMap((group) => {
    const pads = [...group] as PortPad[]
    const aliases = [...new Set(pads.flatMap((pad) => pad.connectedTo))]
    const net = aliases.find((alias) => alias.startsWith("source_net_"))
    if (!net || pads.length < 2 || aliases.some((a) => assigned.has(a)))
      return []
    const points = pads.map((pad) => ({
      x: pad.center.x,
      y: pad.center.y,
      layer: pad.layers[0],
      layers: pad.layers,
      pcb_port_id: pad.circuitJsonMetadata!.pcb_port_id!,
    }))
    return pads.map((pad, index) => ({
      pad,
      net,
      // The oracle inspects the first terminal; keep every other terminal.
      connection: {
        name: net,
        pointsToConnect: [
          points[index],
          ...points.filter((_, other) => other !== index),
        ],
      },
    }))
  })
}

const hasViaSite = (request: SimpleRouteJson, pending: PendingPad): boolean =>
  getPadEscape({
    input: request,
    connection: pending.connection,
    end: 0,
    viaTargetLayer: "bottom",
  }) === "via_site"

test("ButterStick address/command tuning takes the last via sites of two pending RAM pads", async (): Promise<void> => {
  // Core hands each phase request to the solver without options.
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(input).toEqual(original)

  const output = solver.getOutput()
  const traces = output.traces!
  expect(traces).toHaveLength(input.traces!.length + 3)
  expect(traces.slice(0, input.traces!.length)).toEqual(input.traces!)
  const native = {
    inputSrj: nativeValidationSrj({
      ...input,
      connections: [...input.connections, ...fixedConnections],
    }),
    routedSrj: nativeValidationSrj({
      ...output,
      connections: [...output.connections, ...fixedConnections],
    }),
  }
  const connectivity = validateOriginalEndpointConnectivity(native)
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(19)
  expect(
    validateRoutedCopperDrc({
      ...native,
      clearance: input.minTraceToPadEdgeClearance!,
    }).valid,
  ).toBe(true)
  const [report] = busLengthReports(input, traces)
  expect(report!.aboveMinimumLength).toBe(true)
  expect(report!.matched).toBe(true)

  // Pending: the next address/command bus and the remaining phase. A pad
  // loses its escape via only if it had one before this bus.
  const pending = getPendingPads(input)
  expect(new Set(pending.map((p) => p.net)).size).toBe(36)
  const routed = { ...input, traces }
  const lost = pending.filter(
    (p) => hasViaSite(input, p) && !hasViaSite(routed, p),
  )
  expect(lost.map((p) => p.net).sort()).toEqual([
    "source_net_52",
    "source_net_53",
  ])

  const graphics = new BusLanesSolver(routed).visualize()
  const left = Math.min(...input.obstacles.map((o) => o.center.x - o.width / 2))
  const top = Math.max(...input.obstacles.map((o) => o.center.y + o.height / 2))
  graphics.circles = [
    ...(graphics.circles ?? []),
    ...lost.map((p) => ({
      center: p.pad.center,
      radius: 0.5,
      fill: "rgba(220, 38, 38, 0.45)",
      label: `${p.net}: no via site left`,
    })),
  ]
  graphics.texts = [
    {
      x: left,
      y: top + 1.6,
      text: `U11 address/command bus routed and matched; its tuning leaves ${lost.length} pending RAM pads without a via site`,
      color: lost.length ? "#b91c1c" : "#166534",
      fontSize: 0.55,
      anchorSide: "bottom_left",
    },
    {
      x: left,
      y: top + 0.8,
      text: lost.length
        ? `Filled red: ${lost.map((p) => p.net).join(", ")} (each had a via site before this bus)`
        : "Every pending pad that had a via site before this bus keeps one",
      color: "#374151",
      fontSize: 0.45,
      anchorSide: "bottom_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
