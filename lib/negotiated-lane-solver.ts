import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { layerColor } from "./layer-colors"
import { routeNegotiatedLanes } from "./negotiated-lane-router"
import type { SimpleRouteJson, Trace } from "./types"

export interface NegotiatedLaneStage {
  connectionNames: string[]
  /** Router options for this stage only (zone, viaCost, maxIters, ...). */
  options?: Record<string, unknown>
}

export interface NegotiatedLaneOptions {
  /** Routing stages in priority order; derived from bus tolerances when omitted. */
  stages?: NegotiatedLaneStage[]
  /** Tuning-lane band between the two packages along the travel axis, in mm. */
  zone?: [number, number]
  /** Routing window; defaults to the terminals' bounds grown by `margin`. */
  region?: { minX: number; maxX: number; minY: number; maxY: number }
  margin?: number
  /** Via price in mm of detour for the tightest buses and for everything else. */
  criticalViaCost?: number
  viaCost?: number
  /** Routing orders tried per stage before its stuck nets are promoted. */
  attemptsPerStage?: number
  /** Routing order of the first attempt; later attempts take the next ones. */
  firstSeed?: number
  /** Times a stage may hand its stuck nets to the stage before it. */
  maxPromotions?: number
  /** Passed to every stage of the router. */
  router?: Record<string, unknown>
}

type Point = { x: number; y: number }

/** Routes length-matched buses between two packages on the top and bottom layers.
 *
 * Unlike the single-carrier bus-lanes model, a matched signal may change layer
 * anywhere along its route. This is what a pinout needs whose ball order cannot
 * be untangled on two layers (most BGA processor to memory links on a four-layer
 * board). Routing is negotiated congestion on a fine grid; every net crosses a
 * tuning zone between the packages on a lane of its own whose neighbouring strip
 * holds its meander, a differential pair is one coupled centreline on one layer,
 * and the search never returns a path longer than its bus window.
 *
 * By default the pairs route first and freeze their copper, then every other
 * net is negotiated jointly; explicit stages can impose a finer priority order. Vias are priced per stage, so the timing
 * critical nets keep them to a minimum and the later stages absorb the rest. A
 * net that a stage cannot place is promoted into the previous stage.
 *
 * `solved` means complete connectivity inside every bus window; callers still
 * run copper DRC. One step routes one stage and can take minutes.
 */
export class NegotiatedLaneSolver extends BaseSolver {
  readonly input: SimpleRouteJson
  readonly options: NegotiatedLaneOptions
  traces: Trace[] = []
  stages: NegotiatedLaneStage[]
  stageIndex = 0
  promotions = 0
  log: string[] = []
  private readonly transposed: boolean
  private readonly working: SimpleRouteJson
  private readonly done: Trace[][] = []
  private readonly routerOptions: Record<string, unknown>

  constructor(input: SimpleRouteJson, options: NegotiatedLaneOptions = {}) {
    super()
    this.input = structuredClone(input)
    this.options = structuredClone(options)
    this.MAX_ITERATIONS = 64
    if (options.stages && !options.stages.length) throw Error("No stages")
    if (
      input.connections.some(
        (c) =>
          c.pointsToConnect.length !== 2 ||
          c.pointsToConnect.some((p) => p.layer !== "top"),
      )
    )
      throw Error(
        "Negotiated lanes require two top-layer terminals per connection",
      )
    const ends = input.connections.map((c) => c.pointsToConnect)
    const spread = (axis: "x" | "y") =>
      Math.min(...ends.map(([a, b]) => Math.abs(a[axis] - b[axis])))
    // lanes run along x; a vertically stacked pair of packages is routed transposed
    this.transposed = spread("y") > spread("x")
    this.working = this.transposed ? transposeSrj(this.input) : this.input
    const points = this.working.connections.flatMap((c) => c.pointsToConnect)
    const first = this.working.connections.map((c) =>
      Math.min(...c.pointsToConnect.map((p) => p.x)),
    )
    const second = this.working.connections.map((c) =>
      Math.max(...c.pointsToConnect.map((p) => p.x)),
    )
    const gapStart = Math.max(...first)
    const gapEnd = Math.min(...second)
    if (gapEnd - gapStart < 3)
      throw Error("Negotiated lanes need a clear band between the packages")
    const gap = gapEnd - gapStart
    // Each end of the tuning zone keeps room past the package's nearest ball for a pair to leave
    // the ball field and gather: the ball, its clearance, a pair width, the gather run and the lead
    // into the zone. A fixed share of the gap is less than that between small, close packages.
    const ro = (options.router ?? {}) as {
      w?: number
      pairGap?: number
      pairLead?: number
    }
    const balls = this.working.obstacles.filter(
      (o) => !(o as { isCopperPour?: boolean }).isCopperPour,
    )
    const mid = (gapStart + gapEnd) / 2
    const rim = (o: (typeof balls)[number], side: 1 | -1) =>
      o.center.x + (side * Math.abs(o.width)) / 2
    const padStart = Math.max(
      gapStart,
      ...balls.filter((o) => o.center.x < mid).map((o) => rim(o, 1)),
    )
    const padEnd = Math.min(
      gapEnd,
      ...balls.filter((o) => o.center.x >= mid).map((o) => rim(o, -1)),
    )
    const escape =
      (input.minTraceToPadEdgeClearance ?? 0.12) +
      2 * (ro.w ?? input.minTraceWidth) +
      (ro.pairGap ?? 0.18) +
      0.7 +
      (ro.pairLead ?? 0.3)
    const zoneStart = Math.max(gapStart + 0.3 * gap, padStart + escape),
      zoneEnd = Math.min(gapEnd - 0.2 * gap, padEnd - escape)
    if (zoneEnd - zoneStart < 1.5)
      throw Error("Negotiated lanes need a clear band between the packages")
    const margin = options.margin ?? 9
    const pick = (o: unknown) =>
      this.transposed && o ? transposeBox(o as Box) : (o as Box | undefined)
    this.routerOptions = {
      region: pick(options.region) ?? {
        minX: Math.min(...points.map((p) => p.x)) - margin,
        maxX: Math.max(...points.map((p) => p.x)) + margin,
        minY: Math.min(...points.map((p) => p.y)) - margin,
        maxY: Math.max(...points.map((p) => p.y)) + margin,
      },
      zone: options.zone ?? [zoneStart, zoneEnd],
      w: Math.max(
        input.minTraceWidth,
        ...input.connections.map((c) => c.nominalTraceWidth ?? c.width ?? 0),
      ),
      ...(options.router ?? {}),
    }
    this.stages = options.stages ?? defaultStages(input)
  }

  override _step() {
    const stage = this.stages[this.stageIndex]
    if (!stage) {
      this.traces = this.done.flat()
      this.solved = true
      return
    }
    if (!stage.connectionNames.length) {
      this.done[this.stageIndex++] = []
      return
    }
    // supplied copper is already in the working frame; finished stages are kept in the input frame
    const earlier = this.done.slice(0, this.stageIndex).flat()
    const frozen = [
      ...(this.working.traces ?? []),
      ...(this.transposed ? earlier.map(transposeTrace) : earlier),
    ]
    let result!: ReturnType<typeof routeNegotiatedLanes>
    const attempts = this.options.attemptsPerStage ?? 3
    // a stalled negotiation is retried in another (deterministic) routing order
    const firstSeed = this.options.firstSeed ?? 0
    for (let seed = firstSeed; seed < firstSeed + attempts; seed++) {
      result = routeNegotiatedLanes(this.working, {
        viaCost: this.options.viaCost ?? 1.2,
        viaCostByBus: this.viaCostByBus(),
        ...this.routerOptions,
        ...(stage.options ?? {}),
        seed,
        preloadedTraces: frozen,
        onlyNets: stage.connectionNames,
      })
      this.log.push(
        `stage ${this.stageIndex} (${stage.connectionNames.length} nets, order ${seed}): ${result.log.at(-1)}`,
      )
      if (result.solved) break
    }
    if (result.solved) {
      this.done[this.stageIndex++] = this.transposed
        ? result.traces.map(transposeTrace)
        : result.traces
      return
    }
    const move = stage.connectionNames.filter((n) => result.stuck.includes(n))
    if (
      this.stageIndex === 0 ||
      !move.length ||
      this.promotions >= (this.options.maxPromotions ?? 6)
    ) {
      this.error = `Negotiated lanes could not place ${result.stuck.join(", ")} in stage ${this.stageIndex}`
      this.failed = true
      return
    }
    // a net walled in by more important copper negotiates with it instead
    stage.connectionNames = stage.connectionNames.filter(
      (n) => !move.includes(n),
    )
    this.stages[this.stageIndex - 1].connectionNames.push(...move)
    this.promotions++
    this.stageIndex--
  }

  private viaCostByBus() {
    const buses = this.input.buses ?? []
    const tightest = Math.min(...buses.map((b) => b.maxLengthSkew ?? Infinity))
    return Object.fromEntries(
      buses.map((b) => [
        b.busId,
        (b.maxLengthSkew ?? Infinity) === tightest && buses.length > 1
          ? (this.options.criticalViaCost ?? 4)
          : (this.options.viaCost ?? 1.2),
      ]),
    )
  }

  getOutput(): SimpleRouteJson {
    return {
      ...this.input,
      traces: [...(this.input.traces ?? []), ...this.traces],
    }
  }

  override visualize(): GraphicsObject {
    const traces = [
      ...(this.input.traces ?? []),
      ...(this.solved ? this.traces : this.done.flat()),
    ]
    return {
      rects: this.input.obstacles.map((o) => ({
        center: o.center,
        width: o.width,
        height: o.height,
        fill: "rgba(120,120,120,0.35)",
        layer: o.layers[0],
      })),
      lines: traces.flatMap((t) =>
        t.route.slice(1).flatMap((p, i) => {
          const q = t.route[i]
          return p.route_type === "wire" &&
            q.route_type === "wire" &&
            p.layer === q.layer
            ? [
                {
                  points: [
                    { x: q.x, y: q.y },
                    { x: p.x, y: p.y },
                  ],
                  strokeColor: layerColor(p.layer),
                  strokeWidth: p.width,
                  layer: p.layer,
                  label: t.connection_name,
                },
              ]
            : []
        }),
      ),
      circles: traces.flatMap((t) =>
        t.route.flatMap((p) =>
          p.route_type === "via"
            ? [
                {
                  center: { x: p.x, y: p.y },
                  radius: (p.via_diameter ?? 0.3) / 2,
                  fill: "rgba(240,200,60,0.8)",
                  label: t.connection_name,
                },
              ]
            : [],
        ),
      ),
    }
  }
}

/** All differential pairs first, then every other net in one joint negotiation.
 *
 * Pairs are the least flexible copper (two coupled members, equal vias, a common
 * gather point at each end), so they claim their corridors while the board is
 * empty. Single-ended nets are then negotiated together: freezing a tight class
 * before a looser one lets the first class wall the second in around the ball
 * fields (address/command wrapped round the memory before the data bytes could
 * leave), whereas a joint negotiation lets slack-rich nets give way. Bus windows
 * and via prices per bus still rank the singles inside that negotiation. */
function defaultStages(input: SimpleRouteJson): NegotiatedLaneStage[] {
  const paired = new Set(
    (input.differentialPairs ?? []).flatMap((p) => p.connectionNames),
  )
  const names = input.connections.map((c) => c.name)
  return [
    { connectionNames: names.filter((n) => paired.has(n)) },
    { connectionNames: names.filter((n) => !paired.has(n)) },
  ].filter((stage) => stage.connectionNames.length)
}

type Box = { minX: number; maxX: number; minY: number; maxY: number }
const swap = <T extends Point>(p: T): T => ({ ...p, x: p.y, y: p.x })
const transposeBox = (b: Box): Box => ({
  minX: b.minY,
  maxX: b.maxY,
  minY: b.minX,
  maxY: b.maxX,
})
const transposeTrace = (t: Trace): Trace => ({
  ...t,
  route: t.route.map(swap),
})
function transposeSrj(input: SimpleRouteJson): SimpleRouteJson {
  return {
    ...input,
    bounds: transposeBox(input.bounds),
    obstacles: input.obstacles.map((o) => ({
      ...o,
      center: swap(o.center),
      width: o.height,
      height: o.width,
    })),
    connections: input.connections.map((c) => ({
      ...c,
      pointsToConnect: c.pointsToConnect.map(swap),
    })),
    traces: input.traces?.map(transposeTrace),
  }
}
