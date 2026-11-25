import { getPcbTraceSelfShortLocation } from "@tscircuit/checks"
import {
  getCopperLayerNames,
  getRouteViaSpanLayers,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { traceStaysInsideOutline } from "../board-outline"
import { CopperConflictIndex } from "../copper-conflict-index"
import { distance, length } from "../geometry"
import { measureSignalPath } from "../measure-signal-path"
import { signalWidth } from "../repair-bus-dogbones"
import { fixedCopper, type Copper } from "../vector-scene"
import type { SimpleRouteJson, Trace } from "../types"
import type { RoutedLengthWindow } from "./get-routed-length-windows"
import { routeThroughLengthWindow } from "./route-through-length-window"
import { shortenRoutedWireSpan } from "./shorten-routed-wire-span"
import { tuneRoutedWireSpan } from "./tune-routed-wire-span"

export class RoutedBusCopper {
  private readonly copper = new WeakMap<Trace, Copper[]>()
  private readonly measured = new WeakMap<Trace, number | null>()
  private readonly selfShorts = new WeakMap<Trace, boolean>()
  private readonly index = new CopperConflictIndex()
  private readonly boardClearance = new WeakMap<Trace, boolean>()
  private readonly drcBoard: Parameters<
    typeof validateRoutedCopperDrc
  >[0]["inputSrj"]
  readonly clearance: number
  readonly stack: string[]

  constructor(
    readonly input: SimpleRouteJson,
    readonly fixed: Trace[],
  ) {
    this.clearance =
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
    this.stack = getCopperLayerNames(input.layerCount)
    this.drcBoard = {
      ...input,
      traces: [],
      buses: [],
      obstacles: input.obstacles.map((o) => ({ ...o, type: "rect" as const })),
      connections: input.connections.map((c) => ({
        ...c,
        pointsToConnect: c.pointsToConnect.map(({ layers, ...point }) => point),
      })),
    }
  }
  pitch(multiplier: number) {
    return Number(
      (
        Math.max(this.clearance, this.input.minTraceWidth / 4) * multiplier
      ).toPrecision(12),
    )
  }
  private traceCopper(trace: Trace) {
    let copper = this.copper.get(trace)
    if (!copper) {
      copper = fixedCopper({ ...this.input, obstacles: [], traces: [trace] })
      this.copper.set(trace, copper)
    }
    return copper
  }
  conflicts(trace: Trace, obstacles: Trace[]) {
    return obstacles.filter(
      (other) =>
        other.connection_name !== trace.connection_name &&
        this.index.firstConflict(
          this.traceCopper(trace),
          this.traceCopper(other),
          this.clearance - 1e-7,
        ),
    )
  }
  hasConflict(trace: Trace, obstacles: Trace[]) {
    return obstacles.some(
      (other) =>
        other.connection_name !== trace.connection_name &&
        this.index.firstConflict(
          this.traceCopper(trace),
          this.traceCopper(other),
          this.clearance - 1e-7,
        ),
    )
  }
  meetsWindow(window: RoutedLengthWindow, trace: Trace) {
    const within = (mm: number) =>
      mm >= window.minMm - 1e-7 && mm <= window.maxMm + 1e-7
    if (
      !within(length(trace.route)) ||
      trace.route.some(
        (p) =>
          p.route_type === "wire" && !window.allowedLayers.includes(p.layer),
      )
    )
      return false
    let mm = this.measured.get(trace)
    if (mm === undefined) {
      mm = measureSignalPath({
        input: this.input,
        traces: [
          trace,
          ...this.fixed.filter(
            (t) => t.connection_name === trace.connection_name,
          ),
        ],
        connectionName: window.connection.name,
        from: window.from,
        to: window.to,
      })
      this.measured.set(trace, mm)
    }
    return mm !== null && within(mm)
  }
  isSelfShort(trace: Trace) {
    let short = this.selfShorts.get(trace)
    if (short === undefined) {
      short = Boolean(
        getPcbTraceSelfShortLocation(
          trace.route.map((p) =>
            p.route_type === "wire"
              ? p
              : {
                  ...p,
                  outer_diameter:
                    p.via_diameter ?? this.input.minViaPadDiameter,
                  layers: getRouteViaSpanLayers({
                    fromLayer: p.from_layer,
                    toLayer: p.to_layer,
                    layers: p.layers,
                    layerNames: this.stack,
                    allowBlindAndBuriedVias:
                      this.input.allowBlindAndBuriedVias ?? false,
                  }),
                },
          ),
        ),
      )
      this.selfShorts.set(trace, short)
    }
    return short
  }
  clearsBoard(trace: Trace) {
    let valid = this.boardClearance.get(trace)
    if (valid === undefined) {
      const candidate = {
        ...trace,
        connection_name:
          trace.connection_name ?? trace.source_trace_id ?? trace.pcb_trace_id,
      }
      valid =
        traceStaysInsideOutline(this.input, trace) &&
        validateRoutedCopperDrc({
          inputSrj: this.drcBoard,
          routedSrj: { ...this.drcBoard, traces: [candidate] },
          clearance: this.clearance,
          allowBlindAndBuriedVias: this.input.allowBlindAndBuriedVias,
        }).valid
      this.boardClearance.set(trace, valid)
    }
    return valid
  }
  prepareNominal(trace: Trace) {
    const connection = this.input.connections.find(
      (c) => c.name === trace.connection_name,
    )
    if (!connection) return trace
    const width = signalWidth(this.input, connection)
    const route: Trace["route"] = []
    let changed = false
    for (const p of trace.route) {
      const last = route.at(-1)
      const point =
        p.route_type === "wire" && p.width < width ? { ...p, width } : p
      if (
        last?.route_type === "wire" &&
        point.route_type === "wire" &&
        last.layer === point.layer &&
        distance(point, last) < 1e-8
      ) {
        route[route.length - 1] = { ...last, ...point }
        changed = true
      } else {
        route.push(point)
        changed ||= p !== point
      }
    }
    return changed ? { ...trace, route } : trace
  }
  tune({
    window,
    trace,
    obstacles,
  }: {
    window: RoutedLengthWindow
    trace: Trace
    obstacles: Trace[]
  }) {
    return tuneRoutedWireSpan({ input: this.input, window, trace, obstacles })
  }
  /** Start with the existing carrier and try a finer grid only after a coarser
   * search fails. Grid pitch follows the board clearance. */
  plan(
    window: RoutedLengthWindow,
    {
      trace,
      obstacles,
      refine,
    }: { trace: Trace; obstacles: Trace[]; refine: boolean },
  ) {
    const acceptable = (t: Trace | undefined) =>
      t && !this.hasConflict(t, obstacles) && this.meetsWindow(window, t)
    if (acceptable(trace)) return trace
    const initialMm = length(trace.route)
    const deficit = window.targetMm - initialMm
    let tuned: Trace | undefined
    if (deficit > 0) tuned = this.tune({ window, trace, obstacles })
    if (deficit < 0)
      tuned = shortenRoutedWireSpan({
        input: this.input,
        connection: window.connection,
        trace,
        obstacles,
        targetMm: window.targetMm,
      })
    if (acceptable(tuned)) return tuned
    const pitches = refine ? [0.75, 0.5] : [1.05, 0.65]
    for (const pitch of pitches) {
      let tuneAttempts = 0
      for (let candidate of routeThroughLengthWindow({
        input: this.input,
        window,
        trace,
        obstacles,
        step: this.pitch(pitch),
        split: refine,
        tuningSlackMm: 4,
      })) {
        if (this.hasConflict(candidate, obstacles)) continue
        if (length(candidate.route) < window.minMm - 1e-7) {
          if (++tuneAttempts > 12) continue
          const tuned = this.tune({ window, trace: candidate, obstacles })
          if (!tuned) continue
          candidate = tuned
        }
        if (acceptable(candidate)) return candidate
      }
    }
  }
}
