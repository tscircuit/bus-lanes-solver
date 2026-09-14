import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  SimpleRouteJson,
  SolverOptions,
  Connection,
  Trace,
  Point,
  Wire,
} from "./types"
import {
  fixedCopper,
  routeCopper,
  VectorScene,
  type Copper,
} from "./vector-scene"
import { VectorVisibilitySearch } from "./vector-visibility"
import { length, distance, simplify } from "./geometry"
import { windingOrders } from "./winding-orders"
import { resolveBusWidth } from "./impedance"
import { layerColor } from "./layer-colors"
/** Routes on an implicit clearance-offset visibility graph in board-world mm.
 * Every step expands a geometric vertex or commits a complete lane. */
export class BusLanesSolver extends BaseSolver {
  readonly input: SimpleRouteJson
  readonly options: SolverOptions
  phase = "validate"
  failureCode: string | null = null
  traces: Trace[] = []
  private widths = new Map<string, number>()
  private fixed: Copper[] = []
  private orders: Connection[][] = []
  private attempt = 0
  private lane = 0
  private search?: VectorVisibilitySearch
  private bestPartial: Trace[] = []
  constructor(input: SimpleRouteJson, options: SolverOptions = {}) {
    super()
    this.input = structuredClone(input)
    this.options = options
    this.MAX_ITERATIONS = options.maxSearchIterations ?? 200000
  }
  getConstructorParams() {
    return [this.input, this.options]
  }
  getOutput() {
    if (!this.solved) throw Error(this.error ?? "Bus lanes are not solved")
    return {
      ...this.input,
      traces: [...(this.input.traces ?? []), ...this.traces],
    }
  }
  private fail(code: string, message: string) {
    this.failureCode = code
    this.error = message
    this.failed = true
    this.phase = "failed"
  }
  tryFinalAcceptance() {
    if (!this.solved)
      this.fail(
        "search_budget_exhausted",
        "Vector visibility search budget exhausted",
      )
  }
  private initialize() {
    const input = this.input
    if (input.outline?.length) {
      this.fail("unsupported_outline", "Custom board outlines are unsupported")
      return
    }
    if (
      input.differentialPairs?.some(
        (p) => p.traceGap !== undefined || p.maxUncoupledLength !== undefined,
      )
    ) {
      this.fail(
        "unsupported_coupling",
        "Coupled differential geometry is not supported",
      )
      return
    }
    const names = new Set<string>()
    for (const c of input.connections) {
      if (names.has(c.name)) throw Error(`Duplicate connection ${c.name}`)
      names.add(c.name)
      if (c.pointsToConnect.length !== 2) {
        this.fail(
          "invalid_terminals",
          `${c.name}: exactly two terminals required`,
        )
        return
      }
      const [a, b] = c.pointsToConnect
      if (a.layers || b.layers || a.layer !== b.layer) {
        this.fail(
          "layer_change_required",
          `${c.name}: ${a.layer} → ${b.layer}; a common fixed layer is required; fanout handoff layers must agree`,
        )
        return
      }
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite))
        throw Error("Nonfinite terminal")
      this.widths.set(
        c.name,
        c.nominalTraceWidth ?? c.width ?? input.minTraceWidth,
      )
    }
    const claimed = new Set<string>()
    for (const b of input.buses ?? [])
      for (const name of b.connectionNames) {
        const c = input.connections.find((c) => c.name === name)
        if (!c || claimed.has(name))
          throw Error(`Missing or duplicated bus member ${name}`)
        claimed.add(name)
        const layer = c.pointsToConnect[0].layer
        if (b.allowedLayers && !b.allowedLayers.includes(layer))
          throw Error(`${b.busId}: forbidden layer ${layer}`)
        const width = resolveBusWidth(b, layer)
        if (width !== undefined) this.widths.set(name, width)
      }
    for (const width of this.widths.values())
      if (!Number.isFinite(width) || width <= 0 || width < input.minTraceWidth)
        throw Error("Invalid trace width")
    this.fixed = fixedCopper(input)
    for (const c of input.connections)
      for (const p of c.pointsToConnect)
        this.fixed.push({
          a: p,
          b: p,
          layer: p.layer,
          radius: this.widths.get(c.name)! / 2,
          owners: [c.name],
        })
    this.orders = windingOrders(input.connections)
    if (!input.connections.length) {
      this.solved = true
      this.phase = "solved"
      return
    }
    this.phase = "route"
    this.startLane()
  }
  private scene(c: Connection) {
    return new VectorScene(this.input, c, this.widths.get(c.name)!, [
      ...this.fixed,
      ...this.traces.flatMap(routeCopper),
    ])
  }
  private startLane() {
    if (this.lane === this.input.connections.length) {
      this.phase = "match"
      return
    }
    const c = this.orders[this.attempt][this.lane],
      [a, b] = c.pointsToConnect
    this.search = new VectorVisibilitySearch(this.scene(c), a, b)
  }
  private retry() {
    if (this.traces.length > this.bestPartial.length)
      this.bestPartial = structuredClone(this.traces)
    this.attempt++
    if (this.attempt >= this.orders.length) {
      this.traces = this.bestPartial
      this.fail(
        "no_planar_route",
        "No collision-free routing found in the vector visibility graph",
      )
      return
    }
    this.traces = []
    this.lane = 0
    this.startLane()
  }
  private route() {
    const s = this.search!
    s.step()
    if (s.solved) {
      const c = this.orders[this.attempt][this.lane]
      this.traces.push({
        type: "pcb_trace",
        pcb_trace_id: `bus_lane_${c.name}`,
        connection_name: c.name,
        source_trace_id: c.source_trace_id ?? c.name,
        route: s.result.map((p) => ({
          route_type: "wire",
          x: p.x,
          y: p.y,
          layer: c.pointsToConnect[0].layer,
          width: this.widths.get(c.name)!,
        })),
      })
      this.lane++
      this.startLane()
    } else if (
      s.failed ||
      s.expanded >= (this.options.maxLaneIterations ?? 4000)
    )
      this.retry()
  }
  private match() {
    const groups = (this.input.buses ?? [])
      .filter((b) => b.maxLengthSkew !== undefined)
      .map((b) => b.connectionNames)
    groups.push(
      ...(this.input.differentialPairs ?? []).map((p) => p.connectionNames),
    )
    const targets = new Map(
      this.traces.map((t) => [t.connection_name!, length(t.route)]),
    )
    for (let pass = 0; pass < groups.length; pass++)
      for (const names of groups) {
        const target = Math.max(...names.map((n) => targets.get(n)!))
        for (const n of names) targets.set(n, target)
      }
    for (const t of this.traces) {
      const delta = targets.get(t.connection_name!)! - length(t.route)
      if (delta < 1e-8) continue
      const connection = this.input.connections.find(
          (c) => c.name === t.connection_name,
        )!,
        scene = this.scene(connection)
      let tuned = false
      for (let i = 0; i < t.route.length - 1 && !tuned; i++) {
        const a = t.route[i],
          b = t.route[i + 1],
          span = distance(a, b)
        if (span < 0.01) continue
        const ux = (b.x - a.x) / span,
          uy = (b.y - a.y) / span
        // Axis-aligned host segments yield exact horizontal/vertical/45° chamfers.
        if (Math.abs(ux) > 1e-9 && Math.abs(uy) > 1e-9) continue
        const w = span * 0.8,
          c = Math.min(delta / 4, w / 8),
          h = delta / 2 + 2 * c * (2 - Math.SQRT2)
        for (const side of [1, -1]) {
          const offset = span * 0.1,
            at = (x: number, y: number) => ({
              x: a.x + ux * x - uy * y * side,
              y: a.y + uy * x + ux * y * side,
            })
          const bump = [
            [0, 0],
            [offset, 0],
            [offset + c, c],
            [offset + c, h - c],
            [offset + 2 * c, h],
            [offset + w - 2 * c, h],
            [offset + w - c, h - c],
            [offset + w - c, c],
            [offset + w, 0],
            [span, 0],
          ].map(([x, y]) => at(x, y))
          if (!scene.pathVisible(bump)) continue
          const next = simplify([
            ...t.route.slice(0, i),
            ...bump,
            ...t.route.slice(i + 2),
          ])
          if (Math.abs(length(next) - targets.get(t.connection_name!)!) > 1e-6)
            continue
          t.route = next.map((p) => ({
            ...p,
            route_type: "wire",
            width: this.widths.get(t.connection_name!)!,
            layer: connection.pointsToConnect[0].layer,
          }))
          tuned = true
          break
        }
      }
      if (!tuned) {
        this.fail(
          "length_matching_failed",
          `${t.connection_name}: insufficient clearance for length tuning`,
        )
        return
      }
    }
    this.phase = "validate_output"
  }
  private validateOutput() {
    for (const c of this.input.connections) {
      const t = this.traces.find((t) => t.connection_name === c.name)
      if (!t) throw Error("Missing lane")
      const scene = this.scene(c)
      if (
        distance(t.route[0], c.pointsToConnect[0]) > 1e-8 ||
        distance(t.route.at(-1)!, c.pointsToConnect[1]) > 1e-8
      )
        throw Error("Broken lane endpoints")
      for (let i = 1; i < t.route.length; i++) {
        const a = t.route[i - 1],
          b = t.route[i],
          dx = Math.abs(a.x - b.x),
          dy = Math.abs(a.y - b.y)
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        )
          throw Error("Forbidden layer transition")
        if (Math.min(dx, dy) > 1e-8 && Math.abs(dx - dy) > 1e-8)
          throw Error("Non-octilinear segment")
        if (!scene.visible(a, b))
          throw Error("Final copper clearance violation")
      }
    }
    this.phase = "solved"
    this.solved = true
  }
  _step() {
    try {
      if (this.phase === "validate") this.initialize()
      else if (this.phase === "route") this.route()
      else if (this.phase === "match") this.match()
      else if (this.phase === "validate_output") this.validateOutput()
    } catch (e) {
      this.fail("constraint_error", String(e))
    }
    this.progress = this.lane / Math.max(1, this.input.connections.length)
    this.stats = {
      phase: this.phase,
      algorithm: "octilinear_visibility",
      attempt: this.attempt,
      lane: this.lane,
      totalLanes: this.input.connections.length,
      vertices: this.search?.vertices.length ?? 0,
      expandedVertices: this.search?.expanded ?? 0,
      frontier: this.search?.open.length ?? 0,
      failureCode: this.failureCode,
      traceLengthsMm: this.traces.map((t) => ({
        name: t.connection_name,
        length: length(t.route),
      })),
    }
  }
  visualize(): GraphicsObject {
    const lines: any[] = [],
      points: any[] = [],
      rects: any[] = [],
      circles: any[] = []
    for (const c of fixedCopper(this.input)) {
      if (c.rect) {
        rects.push({
          center: {
            x: (c.rect.minX + c.rect.maxX) / 2,
            y: (c.rect.minY + c.rect.maxY) / 2,
          },
          width: c.rect.maxX - c.rect.minX,
          height: c.rect.maxY - c.rect.minY,
          layer: c.layer,
          fill: `${layerColor(c.layer)}30`,
          stroke: layerColor(c.layer),
        })
        continue
      }
      if (distance(c.a, c.b) < 1e-9)
        circles.push({
          center: c.a,
          radius: c.radius,
          layer: c.layer,
          fill: "transparent",
          stroke: layerColor(c.layer),
        })
      else
        lines.push({
          points: [
            { x: c.a.x, y: c.a.y },
            { x: c.b.x, y: c.b.y },
          ],
          strokeWidth: c.radius * 2,
          strokeColor: layerColor(c.layer),
          layer: c.layer,
          label: `Fixed fanout [${c.layer}]`,
        })
    }
    for (const t of this.traces)
      lines.push({
        points: t.route.map(({ x, y }) => ({ x, y })),
        strokeWidth: (t.route[0] as Wire).width,
        strokeColor: layerColor((t.route[0] as Wire).layer),
        layer: (t.route[0] as Wire).layer,
        label: t.connection_name,
      })
    for (const c of this.input.connections)
      for (const [i, p] of c.pointsToConnect.entries())
        points.push({
          ...p,
          color: i ? "#d97706" : "#2563eb",
          label: `${c.name} ${i ? "target" : "source"} [${p.layer}]`,
        })
    if (this.search && this.phase === "route") {
      const layer =
        this.orders[this.attempt][this.lane]?.pointsToConnect[0].layer
      for (const edge of this.search.visibleEdges)
        lines.push({
          points: edge,
          strokeWidth: 0.02,
          strokeColor: "#67e8f980",
          layer,
        })
      for (const n of this.search.open.values().slice(0, 80))
        points.push({ ...this.search.vertices[n.id], color: "#06b6d4", layer })
      lines.push({
        points: this.search.currentPath(),
        strokeColor: "#f43f5e",
        strokeWidth: 0.09,
        layer,
      })
    }
    return {
      title: `Vector bus lanes · ${this.phase}`,
      lines,
      points,
      rects,
      circles,
    }
  }
}
