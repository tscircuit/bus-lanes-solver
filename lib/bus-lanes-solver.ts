import { MinHeap } from "./min-heap"
import { windingOrders } from "./winding-orders"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  SimpleRouteJson,
  SolverOptions,
  Connection,
  Point,
  Trace,
  Wire,
} from "./types"
import { distance, segmentDistance, length, simplify } from "./geometry"
import { resolveBusWidth } from "./impedance"
interface Segment {
  a: Point
  b: Point
  radius: number
  layer: string
  owners: string[]
  rect?: { center: Point; width: number; height: number }
}
interface SearchNode extends Point {
  id: string
  g: number
  f: number
  parent?: SearchNode
}
const colors = [
  "#2563eb",
  "#e11d48",
  "#059669",
  "#9333ea",
  "#d97706",
  "#0891b2",
]
/** Via-free, ordered bus routing in board XY (mm, +Y up). Each step expands one
 * search node or performs one validation/tuning operation; no hidden solve(). */
export class BusLanesSolver extends BaseSolver {
  input: SimpleRouteJson
  options: SolverOptions
  phase = "validate"
  traces: Trace[] = []
  failureCode: string | null = null
  private connections: Connection[] = []
  private widths = new Map<string, number>()
  private segments: Segment[] = []
  private spatial = new Map<string, Segment[]>()
  private segmentKeys = new Set<string>()
  private attempt = 0
  private orders: Connection[][] = []
  private laneExpansions = 0
  private fixedSegments: Segment[] = []
  private lane = 0
  private open = new MinHeap<SearchNode>()
  private best = new Map<string, number>()
  private current?: SearchNode
  private expansions = 0
  private tuning = 0
  constructor(input: SimpleRouteJson, options: SolverOptions = {}) {
    super()
    this.input = structuredClone(input)
    this.options = options
    this.MAX_ITERATIONS = options.maxSearchIterations ?? 5000000
  }
  tryFinalAcceptance() {
    if (!this.failed)
      this.fail("search_budget_exhausted", "Bus lane search budget exhausted")
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
  private addSegment(segment: Segment) {
    const key = JSON.stringify(segment)
    if (this.segmentKeys.has(key)) return
    this.segmentKeys.add(key)
    this.segments.push(segment)
    const r = segment.radius + this.input.minTraceWidth + this.clearance
    for (
      let x = Math.floor(Math.min(segment.a.x, segment.b.x) - r);
      x <= Math.ceil(Math.max(segment.a.x, segment.b.x) + r);
      x++
    )
      for (
        let y = Math.floor(Math.min(segment.a.y, segment.b.y) - r);
        y <= Math.ceil(Math.max(segment.a.y, segment.b.y) + r);
        y++
      ) {
        const key = `${segment.layer}:${x}:${y}`,
          bucket = this.spatial.get(key) ?? []
        bucket.push(segment)
        this.spatial.set(key, bucket)
      }
  }
  private get clearance() {
    return (
      this.input.minTraceToPadEdgeClearance ??
      this.input.defaultObstacleMargin ??
      0.075
    )
  }
  private canEdge(edge: [Point, Point], connection: Connection) {
    const layer = connection.pointsToConnect[0].layer,
      width = this.widths.get(connection.name)!,
      margin = width / 2 + (this.input.minBoardEdgeClearance ?? 0),
      b = this.input.bounds
    if (
      edge.some(
        (p) =>
          p.x < b.minX + margin - 1e-9 ||
          p.x > b.maxX - margin + 1e-9 ||
          p.y < b.minY + margin - 1e-9 ||
          p.y > b.maxY - margin + 1e-9,
      )
    )
      return false
    const owned = new Set(
      [
        connection.name,
        connection.source_trace_id,
        ...connection.pointsToConnect.flatMap((p) => [
          p.pointId,
          p.pcb_port_id,
        ]),
      ].filter(Boolean),
    )
    const candidates = new Set<Segment>()
    const r = width / 2 + this.clearance
    for (
      let x = Math.floor(Math.min(edge[0].x, edge[1].x) - r);
      x <= Math.ceil(Math.max(edge[0].x, edge[1].x) + r);
      x++
    )
      for (
        let y = Math.floor(Math.min(edge[0].y, edge[1].y) - r);
        y <= Math.ceil(Math.max(edge[0].y, edge[1].y) + r);
        y++
      )
        for (const s of this.spatial.get(`${layer}:${x}:${y}`) ?? [])
          candidates.add(s)
    for (const s of candidates) {
      if (s.owners.some((owner) => owned.has(owner))) continue
      if (s.rect) {
        const o = s.rect,
          x0 = o.center.x - o.width / 2,
          x1 = o.center.x + o.width / 2,
          y0 = o.center.y - o.height / 2,
          y1 = o.center.y + o.height / 2,
          corners = [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ]
        if (
          edge.some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) ||
          corners.some(
            (p, i) =>
              segmentDistance(edge, [p, corners[(i + 1) % 4]]) < r - 1e-8,
          )
        )
          return false
        continue
      }
      if (segmentDistance(edge, [s.a, s.b]) < s.radius + r - 1e-8) return false
    }
    return true
  }
  private initialize() {
    const input = this.input
    if (
      input.outline?.length &&
      !input.outline.every(
        (p) =>
          [input.bounds.minX, input.bounds.maxX].includes(p.x) &&
          [input.bounds.minY, input.bounds.maxY].includes(p.y),
      )
    ) {
      this.fail(
        "unsupported_outline",
        "bus_lanes currently requires rectangular bounds without a custom outline",
      )
      return
    }
    if (
      input.differentialPairs?.some(
        (p) => p.traceGap !== undefined || p.maxUncoupledLength !== undefined,
      )
    ) {
      this.fail(
        "unsupported_coupling",
        "Coupled-pair geometry is not supported; do not silently discard traceGap/maxUncoupledLength",
      )
      return
    }
    const names = new Set<string>()
    for (const c of input.connections) {
      if (names.has(c.name)) {
        this.fail("invalid_input", `Duplicate connection ${c.name}`)
        return
      }
      names.add(c.name)
      if (c.pointsToConnect.length !== 2) {
        this.fail(
          "invalid_terminals",
          `${c.name}: bus_lanes requires exactly two terminals`,
        )
        return
      }
      const [a, b] = c.pointsToConnect
      if (a.layers || b.layers || a.layer !== b.layer) {
        this.fail(
          "layer_change_required",
          `${c.name}: ${a.layer} → ${b.layer}; fan out both endpoints onto a common fixed layer first`,
        )
        return
      }
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) {
        this.fail("invalid_input", `${c.name}: non-finite coordinates`)
        return
      }
      this.widths.set(
        c.name,
        c.nominalTraceWidth ?? c.width ?? input.minTraceWidth,
      )
    }
    const claimed = new Set<string>()
    for (const bus of input.buses ?? []) {
      for (const name of bus.connectionNames) {
        const c = input.connections.find((c) => c.name === name)
        if (!c || claimed.has(name))
          throw Error(
            `${bus.busId}: missing or multiply assigned connection ${name}`,
          )
        claimed.add(name)
        const layer = c.pointsToConnect[0].layer
        if (bus.allowedLayers && !bus.allowedLayers.includes(layer))
          throw Error(`${bus.busId}: ${layer} is not allowed`)
        const width = resolveBusWidth(bus, layer)
        if (width !== undefined) this.widths.set(name, width)
      }
    }
    for (const [name, width] of this.widths)
      if (!Number.isFinite(width) || width < input.minTraceWidth || width <= 0)
        throw Error(`${name}: invalid trace width`)
    this.connections = [
      ...(input.buses ?? []).flatMap((bus) =>
        bus.connectionNames.map(
          (name) => input.connections.find((c) => c.name === name)!,
        ),
      ),
      ...input.connections.filter((c) => !claimed.has(c.name)),
    ]
    this.orders = windingOrders(this.connections)
    for (const segment of this.inputSegments()) this.addSegment(segment)
    // Reserve every terminal before choosing a winding order. An early lane
    // must never occupy another lane's only attachment point.
    for (const c of this.connections)
      for (const p of c.pointsToConnect)
        this.addSegment({
          a: p,
          b: p,
          radius: this.widths.get(c.name)! / 2,
          layer: p.layer,
          owners: [c.name],
        })
    this.fixedSegments = [...this.segments]
    this.phase = "route"
    this.startLane()
  }
  /** Fixed input geometry is available without advancing the solver. */
  private *inputSegments(): Generator<Segment> {
    const input = this.input
    for (const o of input.obstacles) {
      const a = { x: o.center.x - o.width / 2, y: o.center.y },
        b = { x: o.center.x + o.width / 2, y: o.center.y }
      // The segment/radius bounds index the rectangle; canEdge performs the
      // exact rectangle clearance test.
      for (const layer of o.layers)
        yield {
          a,
          b,
          radius: o.height / 2,
          layer,
          owners: o.connectedTo,
          rect: o,
        }
    }
    const layers = Array.from({ length: input.layerCount }, (_, i) =>
      i === 0 ? "top" : i === input.layerCount - 1 ? "bottom" : `inner${i}`,
    )
    for (const t of input.traces ?? [])
      for (let i = 0; i < t.route.length; i++) {
        const p = t.route[i]
        if (p.route_type === "via") {
          const lo = layers.indexOf(p.from_layer),
            hi = layers.indexOf(p.to_layer)
          for (const layer of p.layers ??
            layers.slice(Math.min(lo, hi), Math.max(lo, hi) + 1))
            yield {
              a: p,
              b: p,
              radius: (p.via_diameter ?? 0.3) / 2,
              layer,
              owners: [t.connection_name ?? "", t.source_trace_id ?? ""],
            }
        } else if (p.route_type === "wire") {
          const q = t.route[i + 1]
          if (q?.route_type === "wire" && q.layer === p.layer)
            yield {
              a: p,
              b: q,
              radius: p.width / 2,
              layer: p.layer,
              owners: [t.connection_name ?? "", t.source_trace_id ?? ""],
            }
        } else throw Error("Unsupported previous-route primitive")
      }
  }
  private retry() {
    this.attempt++
    if (this.attempt >= this.orders.length * 2) return false
    this.connections = this.orders[Math.floor(this.attempt / 2)].map((c) => ({
      ...c,
      pointsToConnect:
        this.attempt % 2 === 1
          ? [...c.pointsToConnect].reverse()
          : c.pointsToConnect,
    }))
    this.traces = []
    this.segments = []
    this.spatial.clear()
    this.segmentKeys.clear()
    for (const segment of this.fixedSegments) this.addSegment(segment)
    this.lane = 0
    this.tuning = 0
    this.phase = "route"
    this.startLane()
    return true
  }
  private startLane() {
    this.laneExpansions = 0
    this.open = new MinHeap<SearchNode>()
    this.best.clear()
    this.current = undefined
    if (this.lane >= this.connections.length) {
      this.phase = "match"
      return
    }
    const c = this.connections[this.lane],
      p = c.pointsToConnect[0],
      goal = c.pointsToConnect[1]
    const start = { x: p.x, y: p.y, id: "0:0", g: 0, f: distance(p, goal) }
    this.open.push(start)
    this.best.set(start.id, 0)
  }
  private commit(path: Point[]) {
    const c = this.connections[this.lane],
      route = simplify(path).map((p) => ({
        ...p,
        route_type: "wire" as const,
        layer: c.pointsToConnect[0].layer,
        width: this.widths.get(c.name)!,
      }))
    const t: Trace = {
      type: "pcb_trace",
      pcb_trace_id: `bus_lanes_${this.lane}`,
      connection_name: c.name,
      source_trace_id: c.source_trace_id,
      route,
    }
    this.traces.push(t)
    for (let i = 1; i < route.length; i++)
      this.addSegment({
        a: route[i - 1],
        b: route[i],
        radius: route[i].width / 2,
        layer: route[i].layer,
        owners: [c.name],
      })
    this.lane++
    this.startLane()
  }
  private search() {
    const c = this.connections[this.lane],
      [start, goal] = c.pointsToConnect,
      step = this.options.gridStep ?? (this.attempt === 0 ? 0.1 : 0.025)
    if (
      !this.open.length ||
      this.laneExpansions >= (this.options.maxLaneIterations ?? 30000)
    ) {
      if (this.retry()) return
      this.fail(
        "no_planar_route",
        `${c.name}: no same-layer route found at ${step} mm resolution; vias are forbidden`,
      )
      return
    }
    const current = this.open.pop()
    if (current.g > (this.best.get(current.id) ?? Infinity)) return
    this.current = current
    this.expansions++
    this.laneExpansions++
    const dx = goal.x - current.x,
      dy = goal.y - current.y
    // Exact endpoint attachment is permitted only along orthogonal or 45° lines.
    const aligned =
      Math.abs(dx) < 1e-8 ||
      Math.abs(dy) < 1e-8 ||
      Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-8
    if (aligned && this.canEdge([current, goal], c)) {
      const path: Point[] = [goal]
      for (let n: SearchNode | undefined = current; n; n = n.parent)
        path.push({ x: n.x, y: n.y })
      this.commit(path.reverse())
      return
    }
    for (const [x, y] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const ix = Math.round((current.x - start.x) / step) + x,
        iy = Math.round((current.y - start.y) / step) + y,
        p = { x: start.x + ix * step, y: start.y + iy * step },
        id = `${ix}:${iy}`,
        g = current.g + step * Math.hypot(x, y)
      if (
        (this.best.get(id) ?? Infinity) <= g ||
        !this.canEdge([current, p], c)
      )
        continue
      this.best.set(id, g)
      this.open.push({
        ...p,
        id,
        g,
        f: g + 1.2 * distance(p, goal),
        parent: current,
      })
    }
    // Off-grid terminals get exact 45°/orthogonal finishing elbows, never a snap.
    for (const p of [
      { x: goal.x, y: current.y },
      { x: current.x, y: goal.y },
    ])
      if (
        distance(current, p) > 1e-8 &&
        this.canEdge([current, p], c) &&
        this.canEdge([p, goal], c)
      ) {
        const path: Point[] = [goal, p]
        for (let n: SearchNode | undefined = current; n; n = n.parent)
          path.push({ x: n.x, y: n.y })
        this.commit(path.reverse())
        return
      }
  }
  private match() {
    const groups = [
      ...(this.input.buses ?? [])
        .filter((b) => b.maxLengthSkew !== undefined)
        .map((b) => ({
          names: b.connectionNames,
          tolerance: b.maxLengthSkew!,
        })),
      ...(this.input.differentialPairs ?? []).map((p) => ({
        names: p.connectionNames,
        tolerance: p.lengthTolerance,
      })),
    ]
    if (this.tuning >= groups.length) {
      this.phase = "validate_output"
      return
    }
    const group = groups[this.tuning++]
    const members = group.names.map(
      (n) => this.traces.find((t) => t.connection_name === n)!,
    )
    if (
      members.some((t) => !t) ||
      !Number.isFinite(group.tolerance) ||
      group.tolerance < 0
    )
      throw Error("Invalid length matching group")
    const target = Math.max(...members.map((t) => length(t.route)))
    for (const trace of members) {
      const delta = target - length(trace.route)
      if (delta <= group.tolerance + 1e-8) continue
      const c = this.connections.find((c) => c.name === trace.connection_name)!
      let matched = false
      const route = trace.route as Wire[]
      for (let i = 1; i < route.length && !matched; i++) {
        const a = route[i - 1],
          b = route[i],
          l = distance(a, b)
        if (l < 4 * (a.width + this.clearance)) continue
        const ux = (b.x - a.x) / l,
          uy = (b.y - a.y) / l
        for (const sign of [1, -1]) {
          const p = { x: a.x + (ux * l) / 4, y: a.y + (uy * l) / 4 },
            q = { x: a.x + (ux * l * 3) / 4, y: a.y + (uy * l * 3) / 4 },
            h = (delta / 2) * sign,
            pp = { x: p.x - uy * h, y: p.y + ux * h },
            qq = { x: q.x - uy * h, y: q.y + ux * h }
          const next = [...route.slice(0, i), p, pp, qq, q, ...route.slice(i)]
          if (next.slice(1).some((p, j) => !this.canEdge([next[j], p], c)))
            continue
          let intersects = false
          for (let j = 1; j < next.length; j++)
            for (let k = j + 2; k < next.length; k++)
              if (
                segmentDistance(
                  [next[j - 1], next[j]],
                  [next[k - 1], next[k]],
                ) <
                a.width + this.clearance - 1e-8
              )
                intersects = true
          if (intersects) continue
          trace.route = next.map((p) => ({
            ...p,
            route_type: "wire",
            layer: a.layer,
            width: a.width,
          }))
          for (let j = 1; j < next.length; j++)
            this.addSegment({
              a: next[j - 1],
              b: next[j],
              radius: a.width / 2,
              layer: a.layer,
              owners: [c.name],
            })
          matched = true
          break
        }
      }
      if (!matched) {
        this.fail(
          "length_matching_failed",
          `${c.name}: cannot add ${delta.toFixed(3)} mm without a clearance violation`,
        )
        return
      }
    }
  }
  _step() {
    try {
      if (this.phase === "validate") this.initialize()
      else if (this.phase === "route") this.search()
      else if (this.phase === "match") this.match()
      else if (this.phase === "validate_output") {
        for (const t of this.traces) {
          const c = this.connections.find((c) => c.name === t.connection_name)!
          for (let i = 1; i < t.route.length; i++) {
            const a = t.route[i - 1],
              b = t.route[i]
            const dx = Math.abs(a.x - b.x),
              dy = Math.abs(a.y - b.y)
            if (Math.min(dx, dy) > 1e-8 && Math.abs(dx - dy) > 1e-8)
              throw Error("Non-octilinear route")
            if (!this.canEdge([a, b], c))
              throw Error("Final route clearance violation")
          }
        }
        for (const t of this.traces)
          if (
            t.route.some(
              (p) =>
                p.route_type !== "wire" ||
                p.layer !== (t.route[0] as Wire).layer,
            )
          )
            throw Error("No-layer-change invariant failed")
        for (const group of this.input.buses ?? []) {
          if (group.maxLengthSkew === undefined) continue
          const lengths = group.connectionNames.map((n) =>
            length(this.traces.find((t) => t.connection_name === n)!.route),
          )
          if (
            Math.max(...lengths) - Math.min(...lengths) >
            group.maxLengthSkew + 1e-7
          )
            throw Error(`${group.busId}: final skew exceeds tolerance`)
        }
        for (const pair of this.input.differentialPairs ?? []) {
          const lengths = pair.connectionNames.map((n) =>
            length(this.traces.find((t) => t.connection_name === n)!.route),
          )
          if (Math.abs(lengths[0] - lengths[1]) > pair.lengthTolerance + 1e-7)
            throw Error("Final differential-pair skew exceeds tolerance")
        }
        this.phase = "solved"
        this.solved = true
      }
    } catch (error) {
      this.fail("constraint_error", String(error))
    }
    this.progress = this.connections.length
      ? this.lane / this.connections.length
      : 0
    this.stats = {
      phase: this.phase,
      attempt: this.attempt,
      lane: this.lane,
      totalLanes: this.connections.length,
      expandedNodes: this.expansions,
      frontier: this.open.length,
      layer: this.connections[this.lane]?.pointsToConnect[0].layer,
      traceLengthsMm: this.traces.map((t) => ({
        name: t.connection_name,
        length: length(t.route),
      })),
      failureCode: this.failureCode,
    }
  }
  visualize(): GraphicsObject {
    const lines: any[] = [],
      points: any[] = [],
      rects: any[] = []
    const c = this.connections[this.lane],
      layer =
        c?.pointsToConnect[0].layer ??
        this.input.connections[0]?.pointsToConnect[0]?.layer
    for (const o of this.input.obstacles.filter((o) =>
      o.layers.includes(layer),
    ))
      rects.push({
        center: o.center,
        width: o.width,
        height: o.height,
        fill: "#cbd5e1",
        stroke: "#64748b",
      })
    for (const s of this.inputSegments()) {
      if (s.layer !== layer) continue
      lines.push({
        points: [s.a, s.b],
        strokeColor: "#94a3b8",
        strokeWidth: Math.max(0.025, s.radius * 2),
      })
    }
    this.traces.forEach((t, i) =>
      lines.push({
        points: t.route,
        strokeColor: colors[i % colors.length],
        strokeWidth: (t.route[0] as Wire).width,
      }),
    )
    for (const [i, connection] of this.input.connections.entries())
      for (const [j, p] of connection.pointsToConnect.entries())
        points.push({
          ...p,
          color: j ? "#d97706" : "#2563eb",
          label: `${connection.name} ${j ? "target" : "source"} [${p.layer}]`,
        })
    for (const p of this.open.values().slice(-500))
      points.push({ x: p.x, y: p.y, color: "#67e8f9" })
    if (this.current) {
      const path = []
      for (let n: SearchNode | undefined = this.current; n; n = n.parent)
        path.push(n)
      lines.push({ points: path, strokeColor: "#f43f5e", strokeWidth: 0.06 })
    }
    return {
      lines,
      points,
      rects,
      title: `Bus lanes · ${this.phase}${this.error ? ` · ${this.error}` : ""}`,
    }
  }
}
