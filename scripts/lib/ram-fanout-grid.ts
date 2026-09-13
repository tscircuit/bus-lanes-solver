import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "@tscircuit/capacity-autorouter"
// Adapted from the AM62L module's offline grid router. Dataset generation uses
// generic mode exclusively; the specialized SoC dogbone path is unavailable.
const MODULE_SIZE = 35,
  EXIT_OFFSET = 17
const LAYERS = [
  "top",
  "inner1",
  "inner2",
  "inner3",
  "inner4",
  "inner5",
  "inner6",
  "bottom",
] as const
function getBgaDogbone(
  _x: number,
  _y: number,
): Array<{ x: number; y: number }> {
  throw Error("Use generic mode for RAM fanout generation")
}

type P = { x: number; y: number; layer: string }

class Heap {
  ids: number[] = []
  costs: number[] = []
  push(id: number, cost: number) {
    let i = this.ids.length
    this.ids.push(id)
    this.costs.push(cost)
    while (i) {
      const p = (i - 1) >> 1
      if (this.costs[p]! <= cost) break
      this.ids[i] = this.ids[p]!
      this.costs[i] = this.costs[p]!
      i = p
    }
    this.ids[i] = id
    this.costs[i] = cost
  }
  pop() {
    const id = this.ids[0]!,
      v = this.ids.pop()!,
      c = this.costs.pop()!
    if (this.ids.length) {
      let i = 0
      while (i * 2 + 1 < this.ids.length) {
        let q = i * 2 + 1
        if (q + 1 < this.ids.length && this.costs[q + 1]! < this.costs[q]!) q++
        if (this.costs[q]! >= c) break
        this.ids[i] = this.ids[q]!
        this.costs[i] = this.costs[q]!
        i = q
      }
      this.ids[i] = v
      this.costs[i] = c
    }
    return id
  }
}

/** Offline grid search. Through-via keepouts span all eight layers; GND blind vias span top/inner1.
 * Rasterization includes a small additional clearance margin.
 * Every result is subsequently checked against exact Circuit JSON geometry.
 */
export function routeGrid(
  input: SimpleRouteJson,
  options: {
    ddrOnly?: boolean
    generic?: boolean
    exitDirection?: { x: number; y: number }
    allowBlindVias?: boolean
    layerSequences?: Record<string, string[][]>
    layerSequenceGroups?: Record<string, string>
    halfSize?: number
    stepMm?: number
    blockedLayers?: number[]
    first?: string[]
    accessFirst?: string[]
    onProgress?: (s: string) => void
    preRoutes?: Record<string, P[]>
  } = {},
) {
  const step = options.stepMm ?? (options.ddrOnly ? 0.025 : 0.05),
    half = options.halfSize ?? MODULE_SIZE / 2 - 0.45,
    W = Math.round((half * 2) / step) + 1,
    N = W * W,
    total = N * LAYERS.length
  const width = 0.075,
    clearance = 0.075,
    viaRadius = 0.11,
    extra = 0.001
  const wire = new Int16Array(total),
    via = new Int16Array(total)
  const holeBlocked = new Int16Array(N),
    viaCenters = new Int16Array(N)
  const toGrid = (x: number) => Math.round((x + half) / step)
  const pos = (i: number) => ({
    x: (i % W) * step - half,
    y: Math.floor((i % N) / W) * step - half,
    layer: LAYERS[Math.floor(i / N)]!,
  })
  const index = (p: P) =>
    LAYERS.indexOf(p.layer as any) * N + toGrid(p.y) * W + toGrid(p.x)
  const stamp = (
    map: Int16Array,
    layer: number,
    x: number,
    y: number,
    hx: number,
    hy: number,
    r: number,
    owner: number,
  ) => {
    const x0 = Math.max(0, Math.floor((x - hx - r + half) / step)),
      x1 = Math.min(W - 1, Math.ceil((x + hx + r + half) / step))
    const y0 = Math.max(0, Math.floor((y - hy - r + half) / step)),
      y1 = Math.min(W - 1, Math.ceil((y + hy + r + half) / step))
    for (let iy = y0; iy <= y1; iy++)
      for (let ix = x0; ix <= x1; ix++) {
        const dx = Math.max(0, Math.abs(ix * step - half - x) - hx),
          dy = Math.max(0, Math.abs(iy * step - half - y) - hy)
        if (dx * dx + dy * dy > r * r) continue
        const id = layer * N + iy * W + ix,
          old = map[id]!
        map[id] = old === 0 || old === owner ? owner : -1
      }
  }
  const bgaViaBlocked = new Uint8Array(N)
  for (const o of input.obstacles.filter(
    (o) => o.width < 0.26 && o.height < 0.26,
  )) {
    const r = viaRadius + o.width / 2
    for (
      let iy = Math.max(0, toGrid(o.center.y - r) - 1);
      iy <= Math.min(W - 1, toGrid(o.center.y + r) + 1);
      iy++
    )
      for (
        let ix = Math.max(0, toGrid(o.center.x - r) - 1);
        ix <= Math.min(W - 1, toGrid(o.center.x + r) + 1);
        ix++
      )
        if (
          Math.hypot(
            ix * step - half - o.center.x,
            iy * step - half - o.center.y,
          ) <
          r + extra
        )
          bgaViaBlocked[iy * W + ix] = 1
  }
  if (options.generic)
    for (const c of input.connections)
      for (const p of c.pointsToConnect) {
        if (p.pcb_port_id) continue
        for (
          let iy = Math.max(0, toGrid(p.y - 0.3) - 1);
          iy <= Math.min(W - 1, toGrid(p.y + 0.3) + 1);
          iy++
        )
          for (
            let ix = Math.max(0, toGrid(p.x - 0.3) - 1);
            ix <= Math.min(W - 1, toGrid(p.x + 0.3) + 1);
            ix++
          )
            if (
              Math.hypot(ix * step - half - p.x, iy * step - half - p.y) < 0.3
            )
              bgaViaBlocked[iy * W + ix] = 1
      }
  const owners = new Map<string, number>()
  input.connections.forEach((c, i) => {
    for (const key of [
      c.name,
      c.source_trace_id,
      ...c.pointsToConnect.flatMap((p) => [p.pcb_port_id, p.pointId]),
    ])
      if (key) owners.set(key, i + 1)
  })
  for (const o of input.obstacles) {
    const owner =
      o.connectedTo.map((k) => owners.get(k)).find((x) => x !== undefined) ?? -1
    // Current package consists only of axis-aligned pad rectangles.
    const rot = (o as any).ccwRotationDegrees ?? 0
    if (Math.abs(rot % 90) > 1e-6)
      throw new Error("Grid generator requires axis-aligned pads")
    const swap = Math.abs(Math.round(rot / 90)) % 2 === 1
    const isBall =
      (o as any).shape === "circle" || (o.width < 0.26 && o.height < 0.26)
    const hx = isBall ? 0 : (swap ? o.height : o.width) / 2,
      hy = isBall ? 0 : (swap ? o.width : o.height) / 2
    const circularRadius = isBall ? o.width / 2 : 0
    for (const l of o.layers) {
      const z = LAYERS.indexOf(l as any)
      if (z < 0) throw new Error(`Unexpected layer ${l}`)
      stamp(
        wire,
        z,
        o.center.x,
        o.center.y,
        hx,
        hy,
        width / 2 + clearance + extra + circularRadius,
        owner,
      )
      // Own-net support-pad access is allowed; BGA via-in-pad is blocked below.
      stamp(
        via,
        z,
        o.center.x,
        o.center.y,
        hx,
        hy,
        viaRadius + clearance + extra + circularRadius,
        owner,
      )
    }
  }
  // Copper from earlier phases remains an obstacle, including blind via barrels.
  if (options.generic)
    for (const trace of input.traces ?? []) {
      const owner = owners.get(trace.connection_name ?? "") ?? -1
      for (let i = 0; i < trace.route.length; i++) {
        const p = trace.route[i]!
        if (p.route_type === "via") {
          const a = LAYERS.indexOf(p.from_layer as any),
            b = LAYERS.indexOf(p.to_layer as any)
          const r = (p.via_diameter ?? 0.22) / 2
          for (let z = Math.min(a, b); z <= Math.max(a, b); z++) {
            stamp(
              wire,
              z,
              p.x,
              p.y,
              0,
              0,
              r + width / 2 + clearance + extra,
              owner,
            )
            stamp(via, z, p.x, p.y, 0, 0, r + viaRadius + 0.1 + extra, owner)
          }
          stamp(holeBlocked, 0, p.x, p.y, 0, 0, 0.205, -1)
        } else if (p.route_type === "wire") {
          const q = trace.route[i + 1]
          if (!q || q.route_type !== "wire" || q.layer !== p.layer) continue
          const z = LAYERS.indexOf(p.layer as any),
            count = Math.max(
              1,
              Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (step / 2)),
            )
          for (let n = 0; n <= count; n++) {
            const x = p.x + ((q.x - p.x) * n) / count,
              y = p.y + ((q.y - p.y) * n) / count,
              r = p.width / 2 + step / 4
            stamp(wire, z, x, y, 0, 0, r + width / 2 + clearance + extra, owner)
            stamp(via, z, x, y, 0, 0, r + viaRadius + clearance + extra, owner)
          }
        }
      }
    }
  // Keep each DDR tuning corridor and its boundary exit available to its own net.
  for (const [ci, c] of input.connections.entries()) {
    const end = c.pointsToConnect.find((p) =>
      p.port_selector?.startsWith("EXIT."),
    )
    if (end && !options.ddrOnly && !options.generic)
      stamp(
        wire,
        LAYERS.indexOf(end.layer as any),
        (end.x - 10) / 2,
        end.y,
        Math.abs(end.x + 10) / 2,
        options.ddrOnly ? 0 : 0.75,
        0.1125,
        ci + 1,
      )
  }
  for (const [ci, c] of input.connections.entries())
    for (const p of c.pointsToConnect) {
      if (
        options.generic ||
        Math.max(Math.abs(p.x), Math.abs(p.y)) < EXIT_OFFSET - 0.1 ||
        p.port_selector?.startsWith("EXIT.")
      )
        continue
      const vertical = Math.abs(p.y) > Math.abs(p.x),
        normal = vertical ? "y" : "x"
      const q = { ...p, [normal]: p[normal] - Math.sign(p[normal]) * 1.2 }
      stamp(
        wire,
        LAYERS.indexOf(p.layer as any),
        (p.x + q.x) / 2,
        (p.y + q.y) / 2,
        Math.abs(p.x - q.x) / 2,
        Math.abs(p.y - q.y) / 2,
        0.16,
        ci + 1,
      )
    }
  if (options.generic && options.exitDirection) {
    const d = options.exitDirection
    for (const [ci, c] of input.connections.entries()) {
      if (c.pointsToConnect.length < 2) continue
      for (const p of c.pointsToConnect) {
        if (p.pcb_port_id) continue
        for (let t = 0; t <= 1.2; t += step / 2) {
          stamp(
            wire,
            LAYERS.indexOf(p.layer as any),
            p.x + d.x * t,
            p.y + d.y * t,
            0,
            0,
            width + clearance + extra,
            ci + 1,
          )
          stamp(
            via,
            LAYERS.indexOf(p.layer as any),
            p.x + d.x * t,
            p.y + d.y * t,
            0,
            0,
            viaRadius + width / 2 + clearance + extra,
            ci + 1,
          )
        }
      }
    }
  }
  if (options.generic) {
    for (let q = 0; q < N; q++) {
      const p = pos(q)
      if (
        p.x < input.bounds.minX ||
        p.x > input.bounds.maxX ||
        p.y < input.bounds.minY ||
        p.y > input.bounds.maxY
      ) {
        for (let z = 0; z < LAYERS.length; z++) {
          wire[z * N + q] = -1
          via[z * N + q] = -1
        }
      }
    }
    for (const [ci, c] of input.connections.entries())
      for (const p of c.pointsToConnect)
        stamp(
          wire,
          LAYERS.indexOf(p.layer as any),
          p.x,
          p.y,
          0,
          0,
          width + clearance + extra,
          ci + 1,
        )
  }
  const scores = new Float32Array(total),
    parents = new Int32Array(total),
    seen = new Int32Array(total),
    closed = new Int32Array(total)
  let serial = 0
  const traces: SimplifiedPcbTrace[] = []
  const free = (map: Int16Array, id: number, owner: number) =>
    map[id] === 0 || map[id] === owner
  const canVia = (q: number, owner: number, span = LAYERS.map((_, i) => i)) =>
    !bgaViaBlocked[q] &&
    (viaCenters[q] === owner ||
      ((holeBlocked[q] === 0 || viaCenters[q] === owner) &&
        span.every((l) => free(via, l * N + q, owner))))
  // Search in (position, sequence stage), not just (position, layer): a layer
  // can occur twice without allowing a route to skip or reverse a transition.
  function solveSequence(a: P, b: P, owner: number, sequence: string[]) {
    if (sequence[0] !== a.layer || sequence.at(-1) !== b.layer)
      throw Error("Layer sequence endpoints do not match")
    const zs = sequence.map((layer) => LAYERS.indexOf(layer as any))
    if (zs.some((z) => z < 0)) throw Error("Unknown sequence layer")
    const count = N * zs.length,
      gScore = new Float32Array(count),
      parent = new Int32Array(count),
      visited = new Uint8Array(count),
      done = new Uint8Array(count),
      lastVia = new Int32Array(count)
    const start = index(a) % N,
      end = (zs.length - 1) * N + (index(b) % N)
    const physical = (id: number) => zs[Math.floor(id / N)]! * N + (id % N)
    const goal = index(b) % N,
      ex = goal % W,
      ey = Math.floor(goal / W)
    const h = (id: number) => {
      const q = id % N,
        dx = Math.abs((q % W) - ex),
        dy = Math.abs(Math.floor(q / W) - ey)
      return (
        Math.max(dx, dy) +
        (Math.SQRT2 - 1) * Math.min(dx, dy) +
        45 * (zs.length - 1 - Math.floor(id / N))
      )
    }
    const heap = new Heap()
    parent[start] = -1
    visited[start] = 1
    heap.push(start, h(start))
    while (heap.ids.length) {
      const id = heap.pop()
      if (done[id]) continue
      done[id] = 1
      if (id === end) {
        const out = []
        for (let p = id; p !== -1; p = parent[p]!) out.push(physical(p))
        return out.reverse()
      }
      const stage = Math.floor(id / N),
        q = id % N,
        x = q % W,
        y = Math.floor(q / W),
        z = zs[stage]!
      const add = (next: number, cost: number) => {
        if (done[next] || !free(wire, physical(next), owner)) return
        const prev = parent[id]!,
          turning =
            prev >= 0 &&
            Math.floor(prev / N) === stage &&
            Math.floor(next / N) === stage &&
            id - prev !== next - id
        const ng = gScore[id]! + cost + (turning ? 2 : 0)
        if (visited[next] && gScore[next]! <= ng) return
        visited[next] = 1
        gScore[next] = ng
        parent[next] = id
        lastVia[next] = Math.floor(next / N) !== stage ? next + 1 : lastVia[id]!
        heap.push(next, ng + h(next))
      }
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        if (x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= W) continue
        if (
          dx &&
          dy &&
          (!free(wire, z * N + q + dx, owner) ||
            !free(wire, z * N + q + dy * W, owner))
        )
          continue
        add(id + dx + dy * W, dx && dy ? Math.SQRT2 : 1)
      }
      if (stage + 1 < zs.length) {
        const nextZ = zs[stage + 1]!,
          span = options.allowBlindVias
            ? LAYERS.map((_, i) => i).filter(
                (i) => i >= Math.min(z, nextZ) && i <= Math.max(z, nextZ),
              )
            : undefined
        if (canVia(q, owner, span)) {
          let near = false
          for (let entry = lastVia[id]!; entry; ) {
            const viaId = entry - 1,
              v = viaId % N,
              dx = ((v % W) - x) * step,
              dy = (Math.floor(v / W) - y) * step
            if (dx * dx + dy * dy < (2 * viaRadius + 0.1 + extra) ** 2) {
              near = true
              break
            }
            entry = lastVia[parent[viaId]!]!
          }
          if (!near) add((stage + 1) * N + q, 45)
        }
      }
    }
    throw Error(`No route for layer sequence ${sequence.join(">")}`)
  }
  const groupSequences = new Map<string, number>()
  function solve(a: P, b: P, owner: number, allowVias = true) {
    const isGround = input.connections[owner - 1]?.name === "N_GND"
    const sequence =
      options.layerSequences?.[input.connections[owner - 1]!.name]
    if (sequence) {
      const group =
          options.layerSequenceGroups?.[input.connections[owner - 1]!.name],
        chosen = group ? groupSequences.get(group) : undefined
      for (let i = 0; i < sequence.length; i++) {
        if (chosen !== undefined && chosen !== i) continue
        try {
          const path = solveSequence(a, b, owner, sequence[i]!)
          if (group) groupSequences.set(group, i)
          return path
        } catch {}
      }
      throw Error(
        "No route with the prescribed DDR transition count and pair topology",
      )
    }
    const isDdrRoute = /^N_DDR0_(?!CAL0)/.test(
      input.connections[owner - 1]?.name ?? "",
    )
    const start = index(a),
      end = index(b),
      endZ = Math.floor(end / N),
      endXY = end % N,
      ex = endXY % W,
      ey = Math.floor(endXY / W)
    if (!free(wire, start, owner) || !free(wire, end, owner))
      throw new Error(
        `Blocked terminal for net ${owner}: ${JSON.stringify({ a, b, aw: wire[start], bw: wire[end] })}`,
      )
    const h = (id: number) => {
      const q = id % N
      return (
        Math.max(Math.abs((q % W) - ex), Math.abs(Math.floor(q / W) - ey)) +
        (Math.SQRT2 - 1) *
          Math.min(Math.abs((q % W) - ex), Math.abs(Math.floor(q / W) - ey)) +
        (Math.floor(id / N) === endZ ? 0 : 45)
      )
    }
    const heap = new Heap()
    serial++
    seen[start] = serial
    scores[start] = 0
    parents[start] = -1
    heap.push(start, h(start))
    let expanded = 0
    while (heap.ids.length) {
      const id = heap.pop()
      if (closed[id] === serial) continue
      closed[id] = serial
      if (id === end) {
        const result: number[] = []
        let p = id
        while (p !== -1) {
          result.push(p)
          p = parents[p]!
        }
        return result.reverse()
      }
      if (++expanded > total) throw new Error("Search exhausted")
      const z = Math.floor(id / N),
        q = id % N,
        x = q % W,
        y = Math.floor(q / W),
        g = scores[id]!
      const add = (next: number, cost: number) => {
        if (options.ddrOnly && isDdrRoute && Math.floor(start / N) !== endZ) {
          const nextZ = Math.floor(next / N),
            startZ = Math.floor(start / N)
          if (nextZ !== startZ && nextZ !== endZ) return
          if (z === endZ && nextZ !== endZ) return
          const startPoint = pos(start),
            nextPoint = pos(next)
          const fromStart = Math.hypot(
            nextPoint.x - startPoint.x,
            nextPoint.y - startPoint.y,
          )
          if (
            nextZ === endZ &&
            fromStart < viaRadius + width / 2 + clearance + extra
          )
            return
          if (z !== nextZ && fromStart < 2 * viaRadius + clearance + extra)
            return
        }
        if (
          (options.ddrOnly && isDdrRoute && pos(next).x < -10 - 1e-7) ||
          (options.generic
            ? (options.blockedLayers ?? [1, 3, 5, 6]).includes(
                Math.floor(next / N),
              )
            : !isGround && [1, 5].includes(Math.floor(next / N))) ||
          (!options.generic &&
            input.connections[owner - 1]?.name !== "N_VDD_CORE" &&
            Math.floor(next / N) === 3) ||
          closed[next] === serial ||
          !free(wire, next, owner)
        )
          return
        const parent = parents[id]!
        const turning =
          parent >= 0 &&
          Math.floor(parent / N) === z &&
          Math.floor(next / N) === z &&
          id - parent !== next - id
        const ng =
          g +
          cost +
          (turning &&
          Math.max(Math.abs(x * step - half), Math.abs(y * step - half)) > 8
            ? 4
            : 0)
        if (seen[next] === serial && scores[next]! <= ng) return
        seen[next] = serial
        scores[next] = ng
        parents[next] = id
        heap.push(next, ng + h(next))
      }
      if (x > 0) add(id - 1, 1)
      if (x + 1 < W) add(id + 1, 1)
      if (y > 0) add(id - W, 1)
      if (y + 1 < W) add(id + W, 1)
      for (const [dx, dy] of options.generic ||
      Math.max(Math.abs(x * step - half), Math.abs(y * step - half)) > 8
        ? [
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
          ]
        : []) {
        if (x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= W) continue
        if (free(wire, id + dx, owner) && free(wire, id + dy * W, owner))
          add(id + dx + dy * W, Math.SQRT2)
      }
      if (allowVias && (options.allowBlindVias || canVia(q, owner))) {
        let prev = id,
          nearVia = false
        for (let k = 0; k < 15; k++) {
          const parent = parents[prev]!
          if (parent < 0) break
          if (Math.floor(parent / N) !== Math.floor(prev / N)) {
            const v = prev % N,
              dx = ((v % W) - x) * step,
              dy = (Math.floor(v / W) - y) * step
            if (dx * dx + dy * dy < 0.205 ** 2 && v !== q) nearVia = true
          }
          prev = parent
        }
        if (!nearVia)
          for (let l = 0; l < LAYERS.length; l++)
            if (
              l !== z &&
              (!options.allowBlindVias ||
                canVia(
                  q,
                  owner,
                  LAYERS.map((_, i) => i).filter(
                    (i) => i >= Math.min(l, z) && i <= Math.max(l, z),
                  ),
                ))
            )
              add(l * N + q, 45)
      }
    }
    throw new Error(`No route ${JSON.stringify({ a, b, owner, expanded })}`)
  }
  // Pull same-layer paths taut using clear straight/45-degree shortcuts.
  // Via positions and endpoints are fixed. Check all cells touched by a
  // shortcut against the clearance-inflated occupancy before committing it.
  function simplify(ids: number[], owner: number): number[] {
    const clearLine = (a: number, b: number) => {
      const z = Math.floor(a / N)
      if (Math.floor(b / N) !== z) return false
      const ax = a % W,
        ay = Math.floor((a % N) / W)
      const dx = (b % W) - ax,
        dy = Math.floor((b % N) / W) - ay
      if (dx && dy && Math.abs(dx) !== Math.abs(dy)) return false
      const samples = Math.max(Math.abs(dx), Math.abs(dy)) * 2
      for (let k = 0; k <= samples; k++) {
        const x = ax + (dx * k) / (samples || 1),
          y = ay + (dy * k) / (samples || 1)
        for (const gx of [Math.floor(x), Math.ceil(x)])
          for (const gy of [Math.floor(y), Math.ceil(y)])
            if (!free(wire, z * N + gy * W + gx, owner)) return false
      }
      return true
    }
    const result: number[] = []
    let i = 0
    while (i < ids.length) {
      result.push(ids[i]!)
      let end = i
      while (
        end + 1 < ids.length &&
        Math.floor(ids[end + 1]! / N) === Math.floor(ids[i]! / N)
      )
        end++
      let next = i + 1
      for (let j = end; j > i + 1; j--) {
        if (clearLine(ids[i]!, ids[j]!)) {
          next = j
          break
        }
      }
      i = next
    }
    return result
  }
  function record(
    ids: number[],
    a: P,
    b: P,
    owner: number,
    connection: SimpleRouteJson["connections"][number],
    branch: number,
    waypoints?: P[],
  ) {
    const points: P[] = [a, ...(waypoints ?? simplify(ids, owner).map(pos)), b]
    const compact: P[] = []
    for (const p of points) {
      const last = compact.at(-1)
      if (
        last &&
        Math.hypot(p.x - last.x, p.y - last.y) < 1e-9 &&
        last.layer === p.layer
      )
        continue
      const prev = compact.at(-2)
      if (
        last &&
        prev &&
        prev.layer === last.layer &&
        last.layer === p.layer &&
        Math.abs(
          (last.x - prev.x) * (p.y - last.y) -
            (last.y - prev.y) * (p.x - last.x),
        ) < 1e-10
      )
        compact.pop()
      compact.push(p)
    }
    const route: SimplifiedPcbTrace["route"] = []
    for (let i = 0; i < compact.length; i++) {
      const p = compact[i]!,
        prev = compact[i - 1]
      if (prev && prev.layer !== p.layer) {
        const groundBlind =
          connection.name === "N_GND" &&
          [prev.layer, p.layer].sort().join() === "inner1,top"
        const barrelLayers = groundBlind
          ? ["top", "inner1"]
          : options.allowBlindVias
            ? LAYERS.slice(
                Math.min(
                  LAYERS.indexOf(prev.layer as any),
                  LAYERS.indexOf(p.layer as any),
                ),
                Math.max(
                  LAYERS.indexOf(prev.layer as any),
                  LAYERS.indexOf(p.layer as any),
                ) + 1,
              )
            : [...LAYERS]
        route.push({
          route_type: "via",
          x: p.x,
          y: p.y,
          from_layer: prev.layer,
          to_layer: p.layer,
          layers: barrelLayers,
          via_diameter: viaRadius * 2,
          via_hole_diameter: 0.1,
        })
        for (let l = 0; l < LAYERS.length; l++) {
          if (!barrelLayers.includes(LAYERS[l])) continue
          stamp(
            wire,
            l,
            p.x,
            p.y,
            0,
            0,
            viaRadius + width / 2 + clearance + extra,
            owner,
          )
          stamp(
            via,
            l,
            p.x,
            p.y,
            0,
            0,
            2 * viaRadius + clearance + extra,
            owner,
          )
        }
        stamp(holeBlocked, 0, p.x, p.y, 0, 0, 0.205, -1)
        viaCenters[index(p) % N] = owner
      }
      route.push({ route_type: "wire", ...p, width })
      if (prev && prev.layer === p.layer) {
        const length = Math.hypot(p.x - prev.x, p.y - prev.y),
          samples = Math.max(1, Math.ceil(length / (step / 2)))
        for (let j = 0; j <= samples; j++) {
          const x = prev.x + ((p.x - prev.x) * j) / samples,
            y = prev.y + ((p.y - prev.y) * j) / samples,
            l = LAYERS.indexOf(p.layer as any)
          stamp(wire, l, x, y, 0, 0, width + clearance + extra, owner)
          stamp(
            via,
            l,
            x,
            y,
            0,
            0,
            width / 2 + viaRadius + clearance + extra,
            owner,
          )
        }
      }
    }
    traces.push({
      type: "pcb_trace",
      pcb_trace_id: `${connection.name}_grid${branch}`,
      connection_name: connection.name,
      source_trace_id: connection.source_trace_id,
      route,
    } as SimplifiedPcbTrace)
  }

  const escaped = new Map<string, P>()
  const accessRoutes = new Map<P, SimplifiedPcbTrace["route"]>()
  const directNets = new Set<string>()
  for (const [ci, c] of input.connections.entries()) {
    const pre = options.preRoutes?.[c.name]
    if (!pre) continue
    record([], pre[0]!, pre.at(-1)!, ci + 1, c, 0, pre)
    directNets.add(c.name)
  }
  // Reserve the BGA dogbone array before any signal can occupy it.
  // All BGA barrels are offset into the gaps between pads.
  const accessEntries = input.connections.flatMap((c, ci) =>
    c.pointsToConnect.map((p, pi) => ({ c, ci, p, pi })),
  )
  accessEntries.sort((a, b) => {
    const bgaFirst =
      Number(b.p.port_selector?.startsWith("U1.")) -
      Number(a.p.port_selector?.startsWith("U1."))
    if (bgaFirst) return bgaFirst
    const ai = options.accessFirst?.indexOf(a.c.name) ?? -1,
      bi = options.accessFirst?.indexOf(b.c.name) ?? -1
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    return (
      Number(b.p.port_selector?.startsWith("U1.")) -
      Number(a.p.port_selector?.startsWith("U1."))
    )
  })
  for (const { ci, c, pi, p } of accessEntries) {
    if (options.generic) continue
    if (options.ddrOnly && p.port_selector?.startsWith("EXIT.")) continue
    if (
      options.preRoutes?.[c.name] ||
      ["N_CLK25_RAW", "N_WKUP_OSC0_XI"].includes(c.name)
    )
      continue
    if (
      input.obstacles.some(
        (o) =>
          o.circuitJsonMetadata?.pcb_plated_hole_id &&
          o.circuitJsonMetadata.pcb_port_id === p.pcb_port_id,
      )
    )
      continue
    const isDdr = c.name.includes("DDR0_") && !c.name.includes("CAL0")
    const data = /DQ|DM/.test(c.name)
    const byte1 = /DDR0_(?:DQ(?:8|9|1[0-5])$|DM1$|DQS1(?:_n)?$)/.test(c.name)
    const ddrGroup = options.ddrOnly
      ? data
        ? byte1
          ? "inner4"
          : "inner6"
        : /DDR0_A[15]$/.test(c.name)
          ? "bottom"
          : "inner2"
      : data
        ? "inner2"
        : "inner4"
    const targetLayer = isDdr
      ? ddrGroup
      : c.name === "N_GND"
        ? "inner1"
        : c.name === "N_VDD_CORE"
          ? "inner3"
          : "inner6"
    let ep: P = { ...p },
      ids: number[] | undefined
    const accessSpan =
      c.name === "N_GND" && p.layer === "top" ? [0, 1] : undefined
    const bga = p.port_selector?.startsWith("U1.")
    if (bga) ep = { ...p, ...getBgaDogbone(p.x, p.y).at(-1)! }
    if (bga && !canVia(index(ep) % N, ci + 1, accessSpan))
      throw Object.assign(new Error(`Blocked dogbone ${p.port_selector}`), {
        connection: c.name,
        partialTraces: traces,
      })
    if (!canVia(index(ep) % N, ci + 1, accessSpan)) {
      const candidates: P[] = []
      for (const r of [0.25, 0.35, 0.5, 0.65, 0.85, 1.1, 1.5, 2])
        for (let dx = -r; dx <= r + 1e-5; dx += 0.05)
          for (const dy of [r, -r]) {
            candidates.push(
              pos(index({ ...p, x: p.x + dx, y: p.y + dy })),
              pos(index({ ...p, x: p.x + dy, y: p.y + dx })),
            )
          }
      let found = false
      for (const q of candidates) {
        if (!canVia(index(q) % N, ci + 1, accessSpan)) continue
        try {
          const trial = solve(p, q, ci + 1, false)
          if (trial.length > 70) continue
          ep = q
          ids = trial
          found = true
          break
        } catch {}
      }
      if (!found)
        throw Object.assign(
          new Error(
            `No safe via access for ${p.port_selector} w=${wire[index(p)]} own=${ci + 1} p=${JSON.stringify(p)}`,
          ),
          { connection: c.name, partialTraces: traces },
        )
    }
    const dest: P = { ...ep, layer: targetLayer }
    if (ids) {
      ids.push(index(dest))
      record(ids, p, dest, ci + 1, c, -pi - 1)
    } else
      record(
        [],
        p,
        dest,
        ci + 1,
        c,
        -pi - 1,
        bga
          ? [
              p,
              ...getBgaDogbone(p.x, p.y).map((q) => ({ ...q, layer: p.layer })),
              dest,
            ]
          : [p, dest],
      )
    escaped.set(`${ci}:${pi}`, dest)
    accessRoutes.set(dest, traces.at(-1)!.route)
  }
  const ordered = input.connections
    .map((c, i) => ({ c, owner: i + 1 }))
    .sort((a, b) => {
      const ai = options.first?.indexOf(a.c.name) ?? -1,
        bi = options.first?.indexOf(b.c.name) ?? -1
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
      const ddr = (c: any) =>
        c.name.includes("DDR0_") && !c.name.includes("CAL0")
      const clk = (c: any) => ["N_CLK25_RAW", "N_WKUP_OSC0_XI"].includes(c.name)
      return (
        Number(clk(b.c)) - Number(clk(a.c)) ||
        Number(ddr(b.c)) - Number(ddr(a.c)) ||
        a.c.pointsToConnect.length - b.c.pointsToConnect.length
      )
    })
  const reverse = (r: SimplifiedPcbTrace["route"]) =>
    r
      .toReversed()
      .map((p) =>
        p.route_type === "via"
          ? { ...p, from_layer: p.to_layer, to_layer: p.from_layer }
          : { ...p },
      )
  if (options.ddrOnly) {
    const ddr = ordered.filter(
      ({ c }) => /^N_DDR0_(?!CAL0)/.test(c.name) && !directNets.has(c.name),
    )
    const group = (name: string) =>
      /DQ|DM/.test(name)
        ? /DDR0_(?:DQ(?:8|9|1[0-5])$|DM1$|DQS1(?:_n)?$)/.test(name)
          ? "byte1"
          : "byte0"
        : "ca"
    const fixed = (name: string) => /DQS|CK0/.test(name)
    ddr.sort(
      (a, b) =>
        ["byte0", "byte1", "ca"].indexOf(group(a.c.name)) -
          ["byte0", "byte1", "ca"].indexOf(group(b.c.name)) ||
        Number(fixed(b.c.name)) - Number(fixed(a.c.name)),
    )
    const gates = ddr.map(({ c, owner }) => ({
      name: c.name,
      owner,
      group: group(c.name),
      point: c.pointsToConnect.find((p) =>
        p.port_selector?.startsWith("EXIT."),
      )!,
    }))
    for (const gate of gates.filter((g) => fixed(g.name))) {
      const l = LAYERS.indexOf(gate.point.layer as any)
      stamp(
        wire,
        l,
        gate.point.x,
        gate.point.y,
        0,
        0,
        width + clearance + extra,
        gate.owner,
      )
    }
    for (const { c, owner } of ddr) {
      const ci = owner - 1,
        pi = c.pointsToConnect.findIndex((p) =>
          p.port_selector?.startsWith("U1."),
        )
      const a = escaped.get(`${ci}:${pi}`)!
      const choices = gates
        .filter(
          (g) =>
            g.group === group(c.name) &&
            (fixed(c.name) ? g.name === c.name : !fixed(g.name)),
        )
        .sort((g, h) => Math.abs(g.point.y - a.y) - Math.abs(h.point.y - a.y))
      let solved = false
      for (const gate of choices) {
        const b = { ...gate.point }
        try {
          const ids = solve(a, b, owner, true)
          const end = { ...gate.point }
          record([], a, end, owner, c, 0, [
            ...simplify(ids, owner).map(pos),
            end,
          ])
          const trace = traces.at(-1)!
          trace.route = [...(accessRoutes.get(a) ?? []), ...trace.route]
          gates.splice(gates.indexOf(gate), 1)
          solved = true
          break
        } catch {}
      }
      if (!solved)
        throw Object.assign(new Error(`No DDR dogbone gate for ${c.name}`), {
          connection: c.name,
          partialTraces: traces,
        })
      options.onProgress?.(`DDR ${c.name} routed on ${a.layer}`)
    }
    return traces.filter((t) => !t.pcb_trace_id.includes("_grid-"))
  }
  for (const [i, { c, owner }] of ordered.entries()) {
    if (options.ddrOnly && !/^N_DDR0_(?!CAL0)/.test(c.name)) continue
    if (directNets.has(c.name)) continue
    options.onProgress?.(
      `${i + 1}/${ordered.length} ${c.name} (${c.pointsToConnect.length} terminals)`,
    )
    const endpoints = c.pointsToConnect.map(
      (p, pi) => escaped.get(`${owner - 1}:${pi}`) ?? p,
    )
    const connected = [endpoints[0]!],
      remaining = endpoints.slice(1)
    let branch = 0
    while (remaining.length) {
      let best = Infinity,
        ai = 0,
        bi = 0
      for (let a = 0; a < connected.length; a++)
        for (let b = 0; b < remaining.length; b++) {
          const p = connected[a]!,
            q = remaining[b]!,
            d = Math.abs(p.x - q.x) + Math.abs(p.y - q.y)
          if (d < best) {
            best = d
            ai = a
            bi = b
          }
        }
      const a = connected[ai]!,
        b = remaining[bi]!
      const ddr = c.name.includes("DDR0_") && !c.name.includes("CAL0")
      try {
        const pre = options.preRoutes?.[c.name]
        record(
          pre
            ? []
            : solve(
                a,
                b,
                owner,
                options.generic ||
                  (!ddr && !["N_CLK25_RAW", "N_WKUP_OSC0_XI"].includes(c.name)),
              ),
          a,
          b,
          owner,
          c,
          branch++,
          pre,
        )
        const trace = traces.at(-1)!
        trace.route = [
          ...(accessRoutes.get(a) ?? []),
          ...trace.route,
          ...reverse(accessRoutes.get(b) ?? []),
        ].filter((p, i, all) => {
          const prev = all[i - 1]
          return !(
            prev?.route_type === "wire" &&
            p.route_type === "wire" &&
            prev.layer === p.layer &&
            Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-8
          )
        })
      } catch (e) {
        throw Object.assign(new Error(`${c.name}: ${(e as Error).message}`), {
          connection: c.name,
          partialTraces: traces,
        })
      }
      connected.push(b)
      remaining.splice(bi, 1)
    }
  }
  return traces.filter((t) => !t.pcb_trace_id.includes("_grid-"))
}
