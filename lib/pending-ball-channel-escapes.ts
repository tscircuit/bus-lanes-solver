import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { boardSegmentIsClear } from "./board-outline"
import { getPendingPadGroups } from "./connected-pad-groups"
import { distance, pointSegmentDistanceToPoints } from "./geometry"
import { getBallChannel } from "./get-ball-channel"
import type { Obstacle, Point, SimpleRouteJson, Trace, Via } from "./types"
import { copperTooClose, fixedCopper, type Copper } from "./vector-scene"

type ChannelEscapes = { reservations: Trace[]; blockingLanes: Set<string> }

type EscapeRules = {
  input: SimpleRouteJson
  layers: string[]
  land: number
  drill: number
  wireMargin: number
  viaMargin: number
  fixed: Copper[]
  pads: Copper[]
  fixedVias: Via[]
  lanes: { name: string; copper: Copper[]; vias: Via[] }[]
}

function findChannelEscape(
  { ball, balls, port }: { ball: Obstacle; balls: Obstacle[]; port: string },
  rules: EscapeRules,
): { reservation: Trace; blockers: string[] } | undefined {
  const channel = getBallChannel(ball, balls)
  if (!channel) return
  const { input, layers, land, drill } = rules
  const start = ball.center
  const width = input.minTraceWidth
  const surface = ball.layers[0]
  const otherSurface = surface === layers[0] ? layers.at(-1)! : layers[0]
  const owners = new Set(ball.connectedTo)
  const isOwned = (piece: Copper): boolean =>
    piece.owners.some((id) => owners.has(id))
  const foreign = rules.fixed.filter((piece) => !isOwned(piece))
  const ownPads = input.allowViaInPad ? [] : rules.pads.filter(isOwned)
  const blocks = (end: Point, piece: Copper): boolean =>
    (piece.layer === surface &&
      copperTooClose(start, end, piece, rules.wireMargin)) ||
    copperTooClose(end, end, piece, rules.viaMargin)

  // The manufactured holes have their own spacing rule, even on the same net.
  const conflictsWithVia = (end: Point, via: Via): boolean => {
    const viaLand = via.via_diameter ?? land
    const viaDrill = via.via_hole_diameter ?? drill
    const holeGap = input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
    return (
      distance(end, via) <
        Math.max(
          (drill + viaDrill) / 2 + holeGap,
          viaLand / 2 + rules.viaMargin,
        ) ||
      pointSegmentDistanceToPoints(via, start, end) <
        viaLand / 2 + rules.wireMargin
    )
  }
  // Prefer the nearest via. A lane is a blocker only if it leaves no sampled
  // site open along this channel. The wire uses the surface, the land all layers.
  let nearest: Point | undefined
  let blockers: string[] = []
  for (
    let offset = width / 4;
    offset <= channel.pitch + 1e-9;
    offset += width / 4
  ) {
    const end = {
      x: start.x + channel.direction.x * offset,
      y: start.y + channel.direction.y * offset,
    }
    if (
      !boardSegmentIsClear({ input, start, end, copperRadiusMm: width / 2 }) ||
      !boardSegmentIsClear({
        input,
        start: end,
        end,
        copperRadiusMm: land / 2,
      }) ||
      foreign.some((piece) => blocks(end, piece)) ||
      rules.fixedVias.some((via) => conflictsWithVia(end, via)) ||
      ownPads.some((pad) => copperTooClose(end, end, pad, drill / 2))
    )
      continue
    const blockedBy = rules.lanes
      .filter(
        (lane) =>
          lane.copper.some((piece) => blocks(end, piece)) ||
          lane.vias.some((via) => conflictsWithVia(end, via)),
      )
      .map((lane) => lane.name)
    if (!nearest) {
      nearest = end
      blockers = blockedBy
    }
    if (!blockedBy.length) {
      blockers = []
      break
    }
  }
  if (!nearest) return
  const via: Via = {
    ...nearest,
    route_type: "via",
    from_layer: surface,
    to_layer: otherSurface,
    layers,
    via_diameter: land,
    via_hole_diameter: drill,
  }
  return {
    blockers,
    reservation: {
      type: "pcb_trace",
      pcb_trace_id: `channel_escape_${port}`,
      connection_name: port,
      route: [
        { ...start, route_type: "wire", width, layer: surface },
        { ...nearest, route_type: "wire", width, layer: surface },
        via,
        { ...nearest, route_type: "wire", width, layer: otherSurface },
      ],
    },
  }
}

/** Find local pad-to-via escapes that existed before this bus, in board-world mm.
 * Only the active lanes can be moved. A reservation never becomes output copper. */
export function getPendingBallChannelEscapes(
  input: SimpleRouteJson,
  traces: Trace[],
): ChannelEscapes {
  const reservations: Trace[] = []
  const blockingLanes = new Set<string>()
  const fields = new Map<string, Obstacle[]>()
  for (const pad of input.obstacles) {
    if (!pad.componentId || pad.shape !== "circle" || pad.layers.length !== 1)
      continue
    const balls = fields.get(pad.componentId)
    if (balls) balls.push(pad)
    else fields.set(pad.componentId, [pad])
  }
  const land = input.minViaPadDiameter
  const drill = input.minViaHoleDiameter
  if (!fields.size || !land || !drill || input.minTraceWidth <= 0)
    return { reservations, blockingLanes }
  const pending = new Set(
    getPendingPadGroups(
      input,
      input.obstacles.filter((pad) => pad.componentId),
    ).flatMap((group) => [...group]),
  )
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const rules: EscapeRules = {
    input,
    land,
    drill,
    layers: getCopperLayerNames(input.layerCount),
    wireMargin: input.minTraceWidth / 2 + clearance,
    viaMargin:
      land / 2 +
      Math.max(clearance, input.minViaEdgeToPadEdgeClearance ?? clearance),
    fixed: fixedCopper(input),
    fixedVias: (input.traces ?? []).flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
    pads: fixedCopper({ ...input, traces: [] }),
    lanes: traces.map((trace) => ({
      name: trace.connection_name!,
      vias: trace.route.filter((point) => point.route_type === "via"),
      copper: fixedCopper({ ...input, obstacles: [], traces: [trace] }),
    })),
  }
  for (const balls of fields.values()) {
    for (const ball of balls) {
      const port = ball.circuitJsonMetadata?.pcb_port_id
      if (!port || !pending.has(ball)) continue
      const escape = findChannelEscape({ ball, balls, port }, rules)
      if (!escape) continue
      reservations.push(escape.reservation)
      for (const name of escape.blockers) blockingLanes.add(name)
    }
  }
  return { reservations, blockingLanes }
}
