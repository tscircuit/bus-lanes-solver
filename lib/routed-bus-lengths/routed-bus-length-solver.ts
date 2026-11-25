import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject, Line } from "graphics-debug"
import { getObstacleGraphics } from "../get-obstacle-graphics"
import { layerColor } from "../layer-colors"
import { busLengthReports } from "../route-lengths"
import type { SimpleRouteJson, Trace } from "../types"
import { fitNominalCarrier } from "./fit-nominal-carrier"
import {
  getRoutedLengthWindows,
  type RoutedLengthWindow,
} from "./get-routed-length-windows"
import { rerouteBlockingCarriers } from "./reroute-blocking-carriers"
import { RoutedBusCopper } from "./routed-bus-copper"

type RoutedBusLengthProblem = {
  input: SimpleRouteJson
  routedTraces: Trace[]
  /** Coupled lanes and caller-supplied routes may be measured, but never moved. */
  fixedConnectionNames?: string[]
}

function getRoutingPriority(window: RoutedLengthWindow) {
  return (
    Math.max(window.initialMm - window.maxMm, 0) * 10 +
    Math.max(window.minMm - window.initialMm, 0) +
    Number(window.maxMm - window.minMm < 0.02) * 3
  )
}

/** Match the selected pad-to-pad paths after the board's initial routing. */
export class RoutedBusLengthSolver extends BaseSolver {
  private routes: Trace[]
  private readonly work: Generator<void>
  private readonly indexByTraceId: Map<Trace["pcb_trace_id"], number>
  constructor(private readonly problem: RoutedBusLengthProblem) {
    super()
    this.routes = [...problem.routedTraces]
    this.indexByTraceId = new Map(
      this.routes.map((trace, index) => [trace.pcb_trace_id, index]),
    )
    this.work = this.matchCarriers()
    this.MAX_ITERATIONS = 10 * problem.routedTraces.length + 10
  }
  override getConstructorParams(): [RoutedBusLengthProblem] {
    return [this.problem]
  }
  override _step(): void {
    if (this.work.next().done) this.solved = true
  }
  override getOutput() {
    if (!this.solved)
      throw new Error("Routed bus length matching is incomplete")
    return { traces: this.routes }
  }
  private indexOf(window: RoutedLengthWindow) {
    return this.indexByTraceId.get(window.trace.pcb_trace_id)!
  }
  private otherTraces(index: number) {
    return [
      ...(this.problem.input.traces ?? []),
      ...this.routes.filter((_, i) => i !== index),
    ]
  }
  private unmatched(windows: RoutedLengthWindow[], copper: RoutedBusCopper) {
    return windows.filter((window) => {
      const index = this.indexOf(window)
      const trace = this.routes[index]
      return (
        !copper.meetsWindow(window, trace) ||
        copper.hasConflict(trace, this.otherTraces(index))
      )
    })
  }
  private *matchCarriers(): Generator<void> {
    const { input, fixedConnectionNames = [] } = this.problem
    const all = getRoutedLengthWindows(input, this.routes)
    const windows = all.filter(
      (w) => !fixedConnectionNames.includes(w.connection.name),
    )
    const mutable = new Set(windows.map((w) => w.trace.pcb_trace_id))
    const copper = new RoutedBusCopper(input, [
      ...(input.traces ?? []),
      ...this.routes.filter((t) => !mutable.has(t.pcb_trace_id)),
    ])
    // Shortening an overly long carrier changes the rest of the board's free
    // corridors. Place those first, along with the tightest reference pairs.
    const ordered = [...windows].sort(
      (a, b) => getRoutingPriority(b) - getRoutingPriority(a),
    )
    for (const refine of [false, true]) {
      for (const window of ordered) {
        const index = this.indexOf(window)
        const next = copper.plan(window, {
          trace: this.routes[index],
          obstacles: this.otherTraces(index),
          refine,
        })
        if (next) this.routes[index] = next
        yield
      }
      if (!this.unmatched(windows, copper).length) break
    }
    const pending = this.unmatched(windows, copper)
    if (pending.length) {
      const alternatives = new Map(
        windows.map((w) => {
          const trace = this.routes[this.indexOf(w)]
          return [
            w.trace.pcb_trace_id,
            copper.meetsWindow(w, trace) ? [trace] : [],
          ] as const
        }),
      )
      for (const window of pending) {
        for (const refine of [false, true]) {
          const proposal = copper.plan(window, {
            trace: window.trace,
            obstacles: copper.fixed,
            refine,
          })
          if (proposal) {
            alternatives.get(window.trace.pcb_trace_id)!.push(proposal)
            break
          }
        }
        yield
      }
      for (const window of pending) {
        const index = this.indexOf(window),
          trace = this.routes[index]
        if (
          copper.meetsWindow(window, trace) &&
          !copper.hasConflict(trace, this.otherTraces(index))
        )
          continue
        const rerouted = rerouteBlockingCarriers({
          window,
          windows,
          routes: this.routes,
          copper,
          alternatives,
        })
        if (rerouted) this.routes = rerouted
        yield
      }
    }
    // Widen only router-owned copper. Supplied fanouts and coupled lanes keep
    // their exact geometry, identifiers and layer spans.
    this.routes = this.routes.map((trace) =>
      mutable.has(trace.pcb_trace_id) ? copper.prepareNominal(trace) : trace,
    )
    for (const refine of [false, true]) {
      let unfinished = 0
      for (const window of windows) {
        const index = this.indexOf(window)
        const next = fitNominalCarrier({
          copper,
          window,
          trace: this.routes[index],
          obstacles: this.otherTraces(index),
          refine,
        })
        if (next) this.routes[index] = next
        else unfinished++
        yield
      }
      if (!unfinished) break
    }
    for (const w of all) {
      const i = this.indexOf(w),
        trace = this.routes[i]
      if (
        !copper.meetsWindow(w, trace) ||
        copper.hasConflict(trace, this.otherTraces(i)) ||
        copper.isSelfShort(trace) ||
        !copper.clearsBoard(trace)
      )
        throw new Error(
          `Unresolved timing or copper contact on ${w.connection.name}`,
        )
    }
    for (const report of busLengthReports(input, this.routes)) {
      if (
        !report.aboveMinimumLength ||
        !report.withinLengthLimit ||
        (report.toleranceMm !== null && !report.matched)
      )
        throw new Error(
          `Routed bus ${report.busId} is outside its timing window`,
        )
    }
  }
  override visualize(): GraphicsObject {
    const { rects, circles } = getObstacleGraphics(this.problem.input.obstacles)
    const lines: Line[] = []
    for (const trace of [
      ...(this.problem.input.traces ?? []),
      ...this.routes,
    ]) {
      for (const [i, p] of trace.route.entries()) {
        const previous = trace.route[i - 1]
        if (p.route_type === "via")
          circles.push({
            center: p,
            radius:
              (p.via_diameter ?? this.problem.input.minViaPadDiameter ?? 0.6) /
              2,
            stroke: layerColor(p.from_layer),
          })
        else if (previous?.route_type === "wire" && previous.layer === p.layer)
          lines.push({
            points: [previous, p],
            layer: p.layer,
            strokeWidth: p.width,
            strokeColor: layerColor(p.layer),
          })
      }
    }
    return { rects, circles, lines }
  }
}
