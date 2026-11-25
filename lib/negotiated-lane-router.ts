// Negotiated two-layer DDR router with mid-route vias, reserved tuning lanes and coupled pairs.
// Board space in mm, +X right, +Y up. Input/Output: SimpleRouteJson (tscircuit).
//
// Model
//  - Fine grid (cfg.p) over both signal layers; negotiated congestion (rip-up and reroute with history).
//  - A "zone" between the two packages holds horizontal tuning lanes. Every net crosses the zone on
//    exactly one lane; the strip above the lane is reserved for that net's length-tuning bumps.
//  - A differential pair is routed as ONE fat centreline on a single layer without vias; its two
//    traces are the +/- offsets of that centreline, joined to their pads by short stubs.
//  - Vias are priced per bus, so important signals keep them to a minimum and the rest absorb them.
type Pt = { x: number; y: number }
export type NegotiatedLaneResult = {
  solved: boolean
  traces: any[]
  partial?: any[]
  stuck: string[]
  log: string[]
  iterations: number
}
/** Routes the connections of `input` on the top and bottom layers; see the model above. */
export function routeNegotiatedLanes(
  input: any,
  options: Record<string, any> = {},
): NegotiatedLaneResult {
  const srj = structuredClone(input)
  const cfg = {
    p: 0.05,
    region: null as null | {
      minX: number
      maxX: number
      minY: number
      maxY: number
    },
    zone: [0, 0] as [number, number],
    zoneRows: null as null | [number, number],
    layers: null as null | string[],
    w: 0.102,
    pairGap: 0.18,
    viaD: 0.3,
    viaHole: 0.15,
    viaCost: 1.0,
    viaCostByBus: {} as Record<string, number>,
    maxIters: 200,
    evalEvery: 4,
    histInc: 1.0,
    presGrowth: 1.25,
    presMax: 30,
    ownCopperRadius: 0.9,
    exitReserve: 1.0,
    exitViaFree: 0.8,
    exitPairGather: 1.0,
    pairTwistCost: 6,
    overLengthWeight: 3,
    pairLead: 0.3,
    laneConflictLen: null as number | null,
    unknot: true,
    joinStubs: true,
    linkOnZoneEdge: false,
    unloop: true,
    cutNotches: true,
    pairNoFold: false,
    stubBoost: 1.6,
    laneSpread: 1.8,
    laneOrderCost: 3,
    laneLayerCost: 2,
    debugNoPath: false,
    gap: 0.102,
    viaGap: null as number | null,
    exactPitch: false,
    incremental: true,
    lengthCap: true,
    finishAt: 8,
    finishAfter: 12,
    finishRadius: 1.6,
    finishMax: 14,
    finishTries: 300,
    stallIters: 60,
    maxKicks: 8,
    kickRadius: 1.0,
    kickGrowth: 0.25,
    stuckRounds: 1e9,
    stuckBoost: 1.6,
    capMargin: 1.5,
    seed: 0,
    slackK: 4,
    pairFarLayerCost: 3,
    stubViaCost: 0.6,
    pairWeight: 6,
    overBoost: 1.6,
    overWeightMax: 60,
    presRestart: 2,
    minWeight: 0.2,
    weightMax: 10,
    weightGrow: 1.1,
    skewMargin: 0.12,
    windowMargin: 0.08,
    allowViaInPad: false,
    // A via may still sit in a ball pad too crowded for via-in-pad everywhere (see inPadOk) when
    // nothing else gets the ball out; each such via costs this much on top of the net's via cost.
    crowdedViaInPadCost: 4,
    congestionByBus: {} as Record<string, number>,
    exactViasByBus: {} as Record<string, number>,
    preloadedTraces: [] as any[],
    phases: null as string[][] | null,
    keepouts: [] as any[],
    onlyNets: null as string[] | null,
    verbose: false,
    busWindow: null as Record<string, [number, number]> | null,
    labels: {} as Record<string, string>,
    ...options,
  }
  const origProblem = {
    connections: srj.connections,
    buses: srj.buses ?? [],
    differentialPairs: srj.differentialPairs ?? [],
  }
  const label = (n: string) => cfg.labels[n] ?? n
  if (cfg.onlyNets)
    srj.connections = srj.connections.filter((c: any) =>
      cfg.onlyNets!.includes(c.name),
    )
  {
    const keep = new Set(srj.connections.map((c: any) => c.name))
    srj.differentialPairs = (srj.differentialPairs ?? []).filter((p: any) =>
      p.connectionNames.every((n: string) => keep.has(n)),
    )
  }
  const logLines: string[] = []
  const log = (...a: any[]) => {
    logLines.push(a.join(" "))
    if (cfg.verbose) console.log(...a)
  }
  let iterations = 0
  const t0 = performance.now()

  // ---------- grid ----------
  // Signal layers, top first. Vias are through vias: a via blocks every layer at its site.
  const P = cfg.p,
    LAYERS: string[] = cfg.layers?.length ? cfg.layers : ["top", "bottom"],
    NL = LAYERS.length
  const layerOf = (id: number) => (id / NN) | 0
  const perLayer = <T,>(f: (l: number) => T): T[] => LAYERS.map((_, l) => f(l))
  const allPts = [
    ...srj.obstacles.map((o: any) => o.center),
    ...origProblem.connections.flatMap((c: any) => c.pointsToConnect),
  ]
  const region = cfg.region ?? {
    minX: Math.min(...allPts.map((p: Pt) => p.x)) - 6,
    maxX: Math.max(...allPts.map((p: Pt) => p.x)) + 2,
    minY: Math.min(...allPts.map((p: Pt) => p.y)) - 6,
    maxY: Math.max(...allPts.map((p: Pt) => p.y)) + 6,
  }
  const anchor = origProblem.connections[0].pointsToConnect[0] // pads sit on the grid
  const X0 = anchor.x - Math.ceil((anchor.x - region.minX) / P) * P,
    Y0 = anchor.y - Math.ceil((anchor.y - region.minY) / P) * P
  const NX = Math.round((region.maxX - X0) / P) + 1,
    NY = Math.round((region.maxY - Y0) / P) + 1,
    NN = NX * NY
  const gx = (x: number) => Math.round((x - X0) / P),
    gy = (y: number) => Math.round((y - Y0) / P)
  const wx = (i: number) => X0 + i * P,
    wy = (j: number) => Y0 + j * P
  const nodeOf = (p: Pt) => gy(p.y) * NX + gx(p.x)

  // ---------- clearances (centre to centre, mm) ----------
  const GAP = cfg.gap // copper-to-copper spacing (TI minimum = one trace width)
  const H = (cfg.w + cfg.pairGap) / 2 // pair member offset from the pair centreline
  const R_TT = 0.235 // thin trace centre to thin trace centre on the grid (>= w + GAP)
  // With trace + gap equal to a whole number of cells, two tracks fit side by side at exactly that
  // pitch (e.g. two between adjacent 0.8 mm-pitch vias): see `exact` below.
  const EXACT =
    cfg.exactPitch &&
    Math.abs((cfg.w + GAP) / P - Math.round((cfg.w + GAP) / P)) < 1e-6
  const R_TV = cfg.viaD / 2 + GAP + cfg.w / 2 + (EXACT ? 0.0035 : 0.02)
  const R_VV =
    Math.max(
      cfg.viaD + GAP,
      cfg.viaHole + (srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.24),
    ) + 0.001
  const C_TP = (srj.minTraceToPadEdgeClearance ?? 0.12) + cfg.w / 2 + 0.006
  const C_VP = (srj.minViaEdgeToPadEdgeClearance ?? 0.15) + cfg.viaD / 2 + 0.006
  const disk = (r: number) => {
    const o: number[] = []
    const n = Math.ceil(r / P)
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++)
        if (Math.hypot(dx, dy) * P < r - 1e-9) o.push(dx, dy)
    return o
  }
  // stamp radii: [into thin raster, into fat raster] for thin copper, fat copper and vias
  // Exact thin-to-thin stamp. Node distances >= r guarantee copper distance >= sqrt(r^2 - (P/sqrt2)^2/... )
  // only up to half a diagonal step, so r is the pitch plus that allowance; the four cells straight
  // across at exactly one pitch are then let through. They are safe: a neighbour that close on a
  // diagonal step has an adjacent node well inside r, which is still blocked.
  const exact = (pitch: number) => {
    const n = Math.round(pitch / P)
    return disk(Math.hypot(pitch, P * Math.SQRT1_2) + 1e-4).filter(
      (_, k, o) => {
        const i = k - (k % 2),
          dx = o[i],
          dy = o[i + 1]
        return !(
          (Math.abs(dx) === n && dy === 0) ||
          (Math.abs(dy) === n && dx === 0)
        )
      },
    )
  }
  const VG = cfg.viaGap ?? GAP,
    viaPitch = cfg.viaD / 2 + VG + cfg.w / 2
  const EXACT_V =
    EXACT && Math.abs(viaPitch / P - Math.round(viaPitch / P)) < 1e-6
  const viaThin = EXACT_V ? exact(viaPitch) : disk(R_TV)
  const D = {
    thinT: EXACT ? exact(cfg.w + GAP) : disk(R_TT),
    thinF: disk(R_TT + H),
    fatT: disk(R_TT + H),
    fatF: disk(R_TT + 2 * H),
    viaT: viaThin,
    viaF: disk(R_TV + H),
    trV: viaThin,
    fatV: disk(R_TV + H),
    viaV: disk(R_VV),
  }

  // ---------- static rasters ----------
  const staticT = LAYERS.map(() => new Uint8Array(NN)),
    staticF = LAYERS.map(() => new Uint8Array(NN)),
    staticV = new Uint8Array(NN),
    // the part of staticV stamped by solid (non-pour) pads with their via-to-pad clearance
    padV = new Uint8Array(NN)
  function obstacleCells(o: any, clear: number): number[] {
    const cells: number[] = [],
      hx = o.width / 2,
      hy = o.height / 2
    const i0 = Math.max(0, gx(o.center.x - hx - clear) - 1),
      i1 = Math.min(NX - 1, gx(o.center.x + hx + clear) + 1),
      j0 = Math.max(0, gy(o.center.y - hy - clear) - 1),
      j1 = Math.min(NY - 1, gy(o.center.y + hy + clear) + 1)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = Math.abs(wx(i) - o.center.x),
          dy = Math.abs(wy(j) - o.center.y)
        const d =
          o.shape === "circle"
            ? Math.hypot(dx, dy) - hx
            : Math.hypot(Math.max(0, dx - hx), Math.max(0, dy - hy))
        if (d < clear) cells.push(j * NX + i)
      }
    return cells
  }
  // res: the far-layer via-site reservation under a bus ball (via-in-pad only)
  type PadStamp = {
    t: Int32Array[]
    v: Int32Array
    f?: Int32Array[]
    res?: Int32Array[]
    cv?: number
  }
  const padKey = (p: Pt) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`
  const padStamps = new Map<string, PadStamp>()
  const connPads = new Set<string>(
    origProblem.connections.flatMap((c: any) => c.pointsToConnect.map(padKey)),
  )
  // Via-in-pad is used only where it leaves the ball field passable: two neighbouring balls with
  // vias in their pads must still let a trace through between the vias. In a finer-pitch field (e.g. a
  // 0.4 mm perimeter band) a via in every pad walls off every layer under it, so those balls leave on
  // their pad layer or step out to a via beside the field instead.
  const inPadPitch = cfg.viaD + cfg.w + 2 * GAP - 1e-6
  const inPadOk = new Set<string>()
  if (cfg.allowViaInPad) {
    const cellOf = (x: number) => Math.floor(x / inPadPitch)
    const hash = new Map<string, any[]>()
    const pads = srj.obstacles.filter(
      (o: any) => !o.isCopperPour && o.layers.length === 1,
    )
    for (const o of pads) {
      const k = `${o.layers[0]}|${cellOf(o.center.x)},${cellOf(o.center.y)}`
      ;(hash.get(k) ?? hash.set(k, []).get(k)!).push(o)
    }
    for (const o of pads) {
      let crowded = false
      for (let dx = -1; dx <= 1 && !crowded; dx++)
        for (let dy = -1; dy <= 1 && !crowded; dy++)
          for (const q of hash.get(
            `${o.layers[0]}|${cellOf(o.center.x) + dx},${cellOf(o.center.y) + dy}`,
          ) ?? [])
            if (
              q !== o &&
              Math.hypot(q.center.x - o.center.x, q.center.y - o.center.y) <
                inPadPitch
            )
              crowded = true
      if (!crowded) inPadOk.add(padKey(o.center))
    }
  }
  // Centre cells of crowded ball pads (see inPadOk) where the pad's own net may still drop a costed via.
  // Such a via is checked exactly against the solid pads around it at the copper gap rather than the
  // wider via-to-pad stamp; anything else stamped there (frozen copper, pours, keepouts) still blocks it.
  // crowdOpen is raised while the owning net's pads are lifted.
  const crowdedV = new Uint8Array(NN),
    crowdOpen = new Uint8Array(NN)
  const solidPads = srj.obstacles.filter((o: any) => !o.isCopperPour)
  const viaClearsPads = (o: any) =>
    solidPads.every((q: any) => {
      if (q === o) return true
      const dx = Math.abs(q.center.x - o.center.x),
        dy = Math.abs(q.center.y - o.center.y),
        hx = Math.abs(q.width) / 2,
        hy = Math.abs(q.height) / 2
      if (dx > hx + 2 || dy > hy + 2) return true
      const d =
        q.shape === "circle"
          ? Math.hypot(dx, dy) - hx
          : Math.hypot(Math.max(0, dx - hx), Math.max(0, dy - hy))
      return d >= GAP + cfg.viaD / 2 + 0.006
    })
  for (const o of srj.obstacles) {
    const ls = o.layers
      .map((l: string) => LAYERS.indexOf(l))
      .filter((l: number) => l >= 0)
    const t = obstacleCells(o, C_TP),
      f = obstacleCells(o, C_TP + H),
      v = obstacleCells(o, C_VP)
    // without via-in-pad a net's own pad keeps vias out like any other pad
    // with via-in-pad a net's via may sit on the centre of its own pad, nowhere else inside the pad's clearance
    const k = padKey(o.center)
    const crowdedSite =
      cfg.allowViaInPad &&
      !inPadOk.has(k) &&
      connPads.has(k) &&
      ls.length === 1 &&
      Math.min(Math.abs(o.width), Math.abs(o.height)) >= cfg.viaD - 1e-9 &&
      viaClearsPads(o)
    if (crowdedSite) crowdedV[nodeOf(o.center)] = 1
    const st: PadStamp = {
      t: perLayer(() => new Int32Array(0)),
      v: new Int32Array(
        inPadOk.has(k) ? v.filter((q) => q === nodeOf(o.center)) : [],
      ),
      ...(crowdedSite ? { cv: nodeOf(o.center) } : {}),
    }
    for (const l of ls) {
      st.t[l] = new Int32Array(t)
      for (const c of t) staticT[l][c]++
      for (const c of f) staticF[l][c]++
    }
    for (const c of v) staticV[c]++
    if (!o.isCopperPour) for (const c of v) padV[c]++
    if (connPads.has(padKey(o.center)) && o.layers.includes("top"))
      padStamps.set(padKey(o.center), st)
  }
  // A via on the centre of a ball pad it fits inside lies within the pad, so on the pad's own layer
  // any copper that clears the pad clears the via too: there the pad's clearance is the via's, and
  // copper on that layer passing the ball must not also block its via site. Value: the pad's layer.
  const inPadSite = new Int8Array(NN).fill(-1)
  if (cfg.allowViaInPad)
    for (const o of srj.obstacles) {
      if (!padStamps.has(padKey(o.center)) || !inPadOk.has(padKey(o.center)))
        continue
      if (Math.min(Math.abs(o.width), Math.abs(o.height)) < cfg.viaD - 1e-9)
        continue
      const ls = o.layers
        .map((l: string) => LAYERS.indexOf(l))
        .filter((l: number) => l >= 0)
      if (ls.length === 1) inPadSite[nodeOf(o.center)] = ls[0]
    }
  // via-in-pad only: keep a via site under every bus ball free of other nets' copper on the far layer
  if (cfg.allowViaInPad)
    for (const c of origProblem.connections)
      for (const p of c.pointsToConnect) {
        const st = padStamps.get(padKey(p))
        if (!st || !inPadOk.has(padKey(p))) continue
        const cells = obstacleCells(
          { shape: "circle", center: p, width: cfg.viaD, height: cfg.viaD },
          GAP + cfg.w / 2 + 0.02,
        )
        st.res ??= perLayer(() => new Int32Array(0))
        for (let l = 1; l < NL; l++) {
          const have = new Set(st.t[l]),
            added = cells.filter((q) => !have.has(q))
          for (const q of added) staticT[l][q]++
          st.t[l] = Int32Array.from(new Set([...st.t[l], ...cells]))
          st.res[l] = Int32Array.from(new Set([...st.res[l], ...added]))
        }
      }
  const applyPad = (st: PadStamp, s: number) => {
    for (let l = 0; l < NL; l++) {
      for (const c of st.t[l]) staticT[l][c] += s
      if (st.f) for (const c of st.f[l]) staticF[l][c] += s
    }
    for (const c of st.v) staticV[c] += s
    if (st.cv !== undefined) crowdOpen[st.cv] -= s
  }
  // a terminal may be a pad or the end of supplied (fanout) copper on either signal layer
  const LOf = (p: any) => Math.max(0, LAYERS.indexOf(p.layer ?? "top"))
  const termNode = (p: any) => nodeOf(p) + LOf(p) * NN

  // Areas a layer's signals must stay out of, e.g. where the adjacent plane is not their reference.
  for (const k of cfg.keepouts as {
    layer: string
    minX: number
    maxX: number
    minY: number
    maxY: number
  }[]) {
    const l = LAYERS.indexOf(k.layer)
    if (l < 0) continue
    for (
      let j = Math.max(0, gy(k.minY));
      j <= Math.min(NY - 1, gy(k.maxY));
      j++
    )
      for (
        let i = Math.max(0, gx(k.minX));
        i <= Math.min(NX - 1, gx(k.maxX));
        i++
      ) {
        staticT[l][j * NX + i]++
        staticF[l][j * NX + i]++
      }
  }

  // ---------- zone / lanes ----------
  const zXL = gx(cfg.zone[0]),
    zXR = gx(cfg.zone[1]),
    laneLen = (zXR - zXL) * P
  const inZone = (i: number) => i > zXL && i < zXR
  const rowsRange = cfg.zoneRows ?? [region.minY + 0.5, region.maxY - 0.5]
  const laneBlocked = LAYERS.map((name) => {
    const b = new Uint8Array(NY).fill(1)
    for (let j = gy(rowsRange[0]); j <= gy(rowsRange[1]); j++)
      if (j >= 0 && j < NY) b[j] = 0
    for (const o of srj.obstacles) {
      if (
        !o.layers.includes(name) ||
        o.center.x + o.width / 2 + C_TP < wx(zXL) ||
        o.center.x - o.width / 2 - C_TP > wx(zXR)
      )
        continue
      for (
        let j = Math.max(0, gy(o.center.y - o.height / 2 - C_TP));
        j <= Math.min(NY - 1, gy(o.center.y + o.height / 2 + C_TP));
        j++
      )
        b[j] = 1
    }
    return b
  })
  const occLane = LAYERS.map(() => new Uint16Array(NY)),
    histLane = LAYERS.map(() => new Float32Array(NY))
  const LP = 0.21,
    BW = LP,
    BG = LP,
    CH = 0.08 // single-trace bump width / gap / chamfer
  const PW = 0.5,
    PG = 0.5,
    PCH = 0.13,
    TRIM = 0.62,
    TRIM_LEN = 1.9 // pair bump width / gap / chamfer, trim amplitude and length
  const kSingle = Math.max(1, Math.floor((laneLen - 0.5) / (BW + BG))),
    kPair = Math.max(1, Math.floor((laneLen - TRIM_LEN - 0.9 + PG) / (PW + PG)))
  const bumpExtra = (a: number, ch = CH) => {
    const c = Math.min(ch, a / 2)
    return 2 * a - (8 - 4 * Math.SQRT2) * c
  }
  const bumpAmp = (e: number, ch = CH) =>
    e >= bumpExtra(2 * ch, ch)
      ? (e + (8 - 4 * Math.SQRT2) * ch) / 2
      : e / (2 - (4 - 2 * Math.SQRT2))
  const PAIR_MIN_AMP = 0.46,
    PAIR_MIN_EXTRA = bumpExtra(PAIR_MIN_AMP, PCH)

  // ---------- preloaded (frozen) copper ----------
  const preTraces: any[] = cfg.preloadedTraces ?? []
  const fixedLen = new Map<string, number>(),
    ownCopper = new Map<string, PadStamp[]>()
  const fixedOf = (name: string) => fixedLen.get(name) ?? 0
  const frozenLen = new Map<string, number>()
  const routedNames = new Set<string>(srj.connections.map((c: any) => c.name))
  function collectCells(cells: number[], offs: number[]): number[] {
    const seen = new Set<number>()
    for (const c of cells) {
      const ci = c % NX,
        cj = (c / NX) | 0
      for (let k = 0; k < offs.length; k += 2) {
        const i = ci + offs[k],
          j = cj + offs[k + 1]
        if (i >= 0 && j >= 0 && i < NX && j < NY) seen.add(j * NX + i)
      }
    }
    return [...seen]
  }
  // exact frozen geometry: [ax, ay, bx, by, halfWidth] per layer, and [x, y, radius] for vias
  const frozenSegs: number[][][] = perLayer(() => []),
    frozenVias: number[][] = []
  {
    const pts: number[][] = perLayer(() => []),
      vias: number[] = []
    const segs = frozenSegs,
      viaGeo = frozenVias
    const blockRows = (l: number, x: number, y: number, r: number) => {
      if (x < wx(zXL) - 0.3 || x > wx(zXR) + 0.3) return
      for (
        let j = Math.max(0, Math.floor((y - r - Y0) / P));
        j <= Math.min(NY - 1, Math.ceil((y + r - Y0) / P));
        j++
      )
        laneBlocked[l][j] = 1
    }
    const inside = (x: number, y: number) =>
      x >= region.minX &&
      x <= region.maxX &&
      y >= region.minY &&
      y <= region.maxY
    for (const t of preTraces)
      for (let i = 0; i < t.route.length; i++) {
        const a = t.route[i]
        if (a.route_type === "via") {
          if (inside(a.x, a.y)) {
            vias.push(nodeOf(a))
            viaGeo.push([a.x, a.y, (a.via_diameter ?? cfg.viaD) / 2])
            for (let l = 0; l < NL; l++) blockRows(l, a.x, a.y, R_TV)
          }
          continue
        }
        const b = t.route[i + 1],
          l = LAYERS.indexOf(a.layer)
        if (l < 0) continue
        const hw = (a.width ?? cfg.w) / 2
        if (!b || b.route_type !== "wire" || b.layer !== a.layer) {
          if (inside(a.x, a.y)) {
            pts[l].push(nodeOf(a))
            segs[l].push([a.x, a.y, a.x, a.y, hw])
          }
          continue
        }
        segs[l].push([a.x, a.y, b.x, b.y, hw])
        const n = Math.max(
          1,
          Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.02),
        )
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n,
            y = a.y + ((b.y - a.y) * k) / n
          if (!inside(x, y)) continue
          pts[l].push(nodeOf({ x, y }))
          blockRows(l, x, y, 0.23)
        }
      }
    // Supplied copper of a net being routed (its fanout): its length counts toward the net, and the
    // part next to the net's terminal must not block the net itself.
    const routed = new Map<string, any>(
      srj.connections.map((c: any) => [c.name, c]),
    )
    for (const t of preTraces) {
      const c = routed.get(t.connection_name)
      if (!c) continue
      const own: number[][] = perLayer(() => [])
      let len = 0
      for (let i = 0; i + 1 < t.route.length; i++) {
        const a = t.route[i],
          b = t.route[i + 1]
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        )
          continue
        const l = LAYERS.indexOf(a.layer),
          d = Math.hypot(b.x - a.x, b.y - a.y)
        len += d
        if (l < 0) continue
        const n = Math.max(1, Math.ceil(d / 0.02))
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n,
            y = a.y + ((b.y - a.y) * k) / n
          if (
            inside(x, y) &&
            c.pointsToConnect.some(
              (q: any) =>
                LAYERS[l] === (q.layer ?? "top") &&
                Math.hypot(q.x - x, q.y - y) < cfg.ownCopperRadius,
            )
          )
            own[l].push(nodeOf({ x, y }))
        }
      }
      fixedLen.set(c.name, (fixedLen.get(c.name) ?? 0) + len)
      if (own.every((o) => !o.length)) continue
      const pad = P * 0.71,
        cells = (ids: number[], offs: number[]) =>
          Int32Array.from(collectCells([...new Set(ids)], offs))
      const st: PadStamp = {
        t: own.map((o) => cells(o, disk(0.225 + pad))),
        f: own.map((o) => cells(o, disk(0.225 + H + pad))),
        v: cells(own.flat(), disk(R_TV + pad)),
      }
      ownCopper.set(c.name, [...(ownCopper.get(c.name) ?? []), st])
    }
    // Bus members already routed in an earlier stage (frozen copper of a net not routed here): the
    // window of their bus must still take in their lengths, since the bus's skew is measured against them.
    for (const t of preTraces) {
      if (routed.has(t.connection_name)) continue
      let len = 0
      for (let i = 0; i + 1 < t.route.length; i++) {
        const a = t.route[i],
          b = t.route[i + 1]
        if (a.route_type === "wire" && b.route_type === "wire" && a.layer === b.layer)
          len += Math.hypot(b.x - a.x, b.y - a.y)
      }
      frozenLen.set(t.connection_name, (frozenLen.get(t.connection_name) ?? 0) + len)
    }
    // Keep a short straight corridor ahead of every supplied-copper terminal (a fanout exit) for its
    // own net, as the via site under a ball is kept: otherwise an earlier net's via lands in front of it.
    for (const c of origProblem.connections)
      for (const q of c.pointsToConnect) {
        const l = LOf(q)
        if (padStamps.has(padKey(q))) continue // a ball has its via site instead
        let prev: any = null,
          touching = 0
        for (const t of preTraces) {
          if (t.connection_name !== c.name) continue
          const r = t.route,
            near = (p: any) =>
              p.route_type === "wire" && Math.hypot(p.x - q.x, p.y - q.y) < 2e-3
          if (near(r.at(-1))) {
            prev = r.at(-2)
            touching++
          } else if (near(r[0])) {
            prev = r[1]
            touching++
          }
        }
        if (
          !prev ||
          touching !== 1 ||
          Math.hypot(q.x - prev.x, q.y - prev.y) < 1e-6
        )
          continue // already routed onward: nothing to keep
        const d = Math.hypot(q.x - prev.x, q.y - prev.y),
          ux = (q.x - prev.x) / d,
          uy = (q.y - prev.y) / d,
          ids: number[] = []
        const vids: number[] = [] // vias stay clear a little further out, so a neighbour can still step aside where the corridors end
        for (let sd = 0; sd <= cfg.exitReserve + cfg.exitViaFree; sd += 0.02) {
          const x = q.x + ux * sd,
            y = q.y + uy * sd
          if (!inside(x, y)) continue
          vids.push(nodeOf({ x, y }))
          if (sd <= cfg.exitReserve) ids.push(nodeOf({ x, y }))
        }
        const pad = P * 0.71,
          uniq = [...new Set(ids)],
          e: Int32Array = new Int32Array(0)
        const tC = Int32Array.from(collectCells(uniq, disk(0.225 + pad))),
          fC = Int32Array.from(collectCells(uniq, disk(0.225 + H + pad))),
          vC = Int32Array.from(
            collectCells([...new Set(vids)], disk(R_TV + pad)),
          )
        const st: PadStamp = {
          t: l === 0 ? [tC, e] : [e, tC],
          f: l === 0 ? [fC, e] : [e, fC],
          v: vC,
        }
        applyPad(st, +1)
        if (routed.has(c.name))
          ownCopper.set(c.name, [...(ownCopper.get(c.name) ?? []), st])
      }
    const m = new Uint8Array(NN)
    const stampSet = (
      cells: number[],
      offs: number[],
      dst: Uint8Array,
      skip?: (c: number) => boolean,
    ) => {
      m.fill(0)
      for (const c of new Set(cells)) {
        const ci = c % NX,
          cj = (c / NX) | 0
        for (let k = 0; k < offs.length; k += 2) {
          const i = ci + offs[k],
            j = cj + offs[k + 1]
          if (i >= 0 && j >= 0 && i < NX && j < NY) m[j * NX + i] = 1
        }
      }
      for (let c = 0; c < NN; c++) if (m[c] && !skip?.(c)) dst[c]++
    }
    // Frozen copper is stamped from its exact geometry, as pads are: a cell is blocked when a trace
    // (or via) centred on it would come closer than the clearance to the frozen copper. Snapping the
    // copper to cells first and padding for the snap error closed every channel whose clearance is
    // exact on the grid, such as one trace between two 0.65 mm-pitch plane vias.
    const EPS = 0.006
    const raster = (
      shapes: number[][],
      reach: (s: number[]) => number,
      dst: Uint8Array,
      skip?: (c: number) => boolean,
    ) => {
      m.fill(0)
      for (const g of shapes) {
        const seg = g.length === 5,
          [ax, ay] = g,
          bx = seg ? g[2] : ax,
          by = seg ? g[3] : ay,
          r = reach(g)
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - X0) / P)),
          i1 = Math.min(NX - 1, Math.ceil((Math.max(ax, bx) + r - X0) / P)),
          j0 = Math.max(0, Math.floor((Math.min(ay, by) - r - Y0) / P)),
          j1 = Math.min(NY - 1, Math.ceil((Math.max(ay, by) + r - Y0) / P))
        const dx = bx - ax,
          dy = by - ay,
          L2 = dx * dx + dy * dy
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const x = wx(i),
              y = wy(j)
            const t = L2
              ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
              : 0
            if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < r)
              m[j * NX + i] = 1
          }
      }
      for (let c = 0; c < NN; c++) if (m[c] && !skip?.(c)) dst[c]++
    }
    const trTr = (g: number[]) => g[4] + cfg.w / 2 + GAP + EPS,
      viaTr = (g: number[]) => g[2] + cfg.w / 2 + GAP + EPS,
      trVia = (g: number[]) => g[4] + cfg.viaD / 2 + GAP + EPS,
      viaVia = (g: number[]) =>
        Math.max(
          g[2] + cfg.viaD / 2 + GAP,
          // hole to hole: frozen holes are taken as this router's
          cfg.viaHole + (srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.24),
        ) + EPS
    for (let l = 0; l < NL; l++) {
      raster(segs[l], trTr, staticT[l])
      raster(viaGeo, viaTr, staticT[l])
      raster(segs[l], (g) => trTr(g) + H, staticF[l])
      raster(viaGeo, (g) => viaTr(g) + H, staticF[l])
      raster(segs[l], trVia, staticV, (c) => inPadSite[c] === l)
    }
    raster(viaGeo, viaVia, staticV)
    if (preTraces.length) log(`preloaded ${preTraces.length} frozen traces`)
  }

  // ---------- nets ----------
  type Net = {
    id: string
    kind: "single" | "fat" | "stub"
    label: string
    bus?: any
    src: number
    dst: number
    ownPads: PadStamp[]
    ignore: Net[]
    viaCost: number
    lenWeight: number
    above: number
    below: number
    path?: number[]
    laneAt?: number
    laneLayer?: number
    stamp?: {
      t: Int32Array[]
      f: Int32Array[]
      v: Int32Array
      lane?: [number, number, number]
    }
    base?: number
    target?: number
    top?: number
    lo?: number
    // single: the connection; fat: the pair; stub: member connection and end index
    conn?: any
    pair?: PairInfo
    member?: 0 | 1
    end?: 0 | 1
    exact?: Pt
    fatLayer?: number
    /** centreline corners ("x,y") where a member's outer mitre would cut into another net's clearance */
    bevel?: [Set<string>, Set<string>]
    active?: boolean
    cong?: number
    exactVias?: number
    stuckRounds?: number
    ideal?: { y: number; layer: number } | null
  }
  type PairInfo = {
    conns: [any, any]
    fat: Net
    stubs: Net[]
    G: [Pt, Pt]
    d: [Pt, Pt]
    M: [[Pt, Pt], [Pt, Pt]]
    leftMember: number
    bus?: any
    twisted: boolean
    termLayer: number
  }
  const busOf = (n: string) =>
    (srj.buses ?? []).find((b: any) => b.connectionNames.includes(n))
  const oct = (a: Pt, b: Pt) => {
    const dx = Math.abs(a.x - b.x),
      dy = Math.abs(a.y - b.y)
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }
  const sortedPads = (c: any): [Pt, Pt] =>
    [...c.pointsToConnect].sort((a: Pt, b: Pt) => a.x - b.x) as [Pt, Pt] // [far-left chip, right chip]
  const nets: Net[] = [],
    pairs: PairInfo[] = []
  const inPair = new Set<string>(
    (srj.differentialPairs ?? []).flatMap((p: any) => p.connectionNames),
  )
  const viaCostOf = (bus: any) => cfg.viaCostByBus[bus?.busId] ?? cfg.viaCost
  for (const c of srj.connections) {
    if (inPair.has(c.name)) continue
    const pads = sortedPads(c),
      bus = busOf(c.name)
    nets.push({
      id: c.name,
      kind: "single",
      label: label(c.name),
      bus,
      conn: c,
      src: termNode(pads[0]),
      dst: termNode(pads[1]),
      ownPads: [
        ...pads.map((p) => padStamps.get(padKey(p))!).filter(Boolean),
        ...(ownCopper.get(c.name) ?? []),
      ],
      ignore: [],
      viaCost: viaCostOf(bus),
      lenWeight: 1,
      above: 2,
      below: 0,
    })
  }
  const allPads = srj.obstacles.filter((o: any) => o.layers.includes("top"))
  const partnerReservation = (pad: Pt): PadStamp[] => {
    const res = padStamps.get(padKey(pad))?.res
    return res?.some((r) => r.length)
      ? [{ t: res, v: new Int32Array(0) }]
      : []
  }
  // Gather points already given to pairs. Two pairs must not share one: pairs leaving the same ball
  // row through the far layer would otherwise both gather on the same spot past the ball field.
  const claimedG: Pt[] = [],
    gSlot = 2 * H + cfg.w + 3 * cfg.w // one pair width plus 3W to the next pair
  const gClash = (g: Pt) =>
    claimedG.some((q) => Math.hypot(q.x - g.x, q.y - g.y) < gSlot - 1e-9)
  const gOnPad = (g: Pt) =>
    allPads.some(
      (o: any) =>
        Math.hypot(o.center.x - g.x, o.center.y - g.y) <
        o.width / 2 + C_TP + H,
    )
  /** Slide a gather point sideways (across its leaving direction) to the nearest free slot. */
  const freeG = (g: Pt, dir: Pt): Pt => {
    if (!gClash(g)) return g
    const side = { x: -dir.y, y: dir.x }
    for (let k = 1; k <= 12; k++)
      for (const sg of [1, -1]) {
        const q = {
          x: g.x + side.x * sg * k * gSlot,
          y: g.y + side.y * sg * k * gSlot,
        }
        if (!gClash(q) && !gOnPad(q)) return q
      }
    return g
  }
  for (const pr of srj.differentialPairs ?? []) {
    const conns = pr.connectionNames.map((n: string) =>
      srj.connections.find((c: any) => c.name === n),
    ) as [any, any]
    const pads = conns.map(sortedPads) as [[Pt, Pt], [Pt, Pt]]
    const G: Pt[] = [],
      d: Pt[] = [],
      M: [Pt, Pt][] = [],
      cands: { d: Pt; g: Pt; score: number; left: number }[][] = [[], []],
      interior: { d: Pt; g: Pt; score: number; left: number }[][] = [[], []]
    for (const e of [0, 1]) {
      const a = pads[0][e],
        b = pads[1][e],
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        other = {
          x: (pads[0][1 - e].x + pads[1][1 - e].x) / 2,
          y: (pads[0][1 - e].y + pads[1][1 - e].y) / 2,
        }
      // leave the pads in the free direction that heads most toward the other chip
      for (const dir of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const reach =
          Math.max(
            (a.x - mid.x) * dir.x + (a.y - mid.y) * dir.y,
            (b.x - mid.x) * dir.x + (b.y - mid.y) * dir.y,
          ) +
          0.7 +
          (padStamps.has(padKey(a)) ? 0 : cfg.exitReserve + cfg.exitPairGather)
        const g = { x: mid.x + dir.x * reach, y: mid.y + dir.y * reach }
        let blocked = false
        for (const o of allPads) {
          if (padKey(o.center) === padKey(a) || padKey(o.center) === padKey(b))
            continue
          for (let s = 0.2; s <= reach + 0.9 && !blocked; s += 0.1) {
            const q = { x: mid.x + dir.x * s, y: mid.y + dir.y * s }
            if (
              Math.hypot(q.x - o.center.x, q.y - o.center.y) <
              o.width / 2 + C_TP + H
            )
              blocked = true
          }
        }
        let score = (other.x - mid.x) * dir.x + (other.y - mid.y) * dir.y
        if (blocked) {
          // An interior ball pair has no free way out as a pair on the pad layer. Its members leave
          // one by one (on the pad layer between balls, or down a via in or beside their pads), so
          // gather the pair just outside the ball field in this direction; used only when no
          // direction is free (below).
          const near = allPads.filter(
            (o: any) =>
              padKey(o.center) !== padKey(a) &&
              padKey(o.center) !== padKey(b) &&
              Math.abs(
                (o.center.x - mid.x) * -dir.y + (o.center.y - mid.y) * dir.x,
              ) <
                o.width / 2 + C_TP + H,
          )
          let last = 0
          for (const o of near) {
            const along =
              (o.center.x - mid.x) * dir.x + (o.center.y - mid.y) * dir.y
            if (along > 0) last = Math.max(last, along + o.width / 2 + C_TP + H)
          }
          const out = last + 0.7
          const gOut = { x: mid.x + dir.x * out, y: mid.y + dir.y * out }
          const t = e === 0 ? dir : { x: -dir.x, y: -dir.y },
            cr = t.x * (a.y - mid.y) - t.y * (a.x - mid.x)
          interior[e].push({
            d: dir,
            g: gOut,
            score: score - out,
            left: cr > 1e-9 ? 0 : cr < -1e-9 ? 1 : -1,
          })
          continue
        }
        // which member is on the left of the direction of travel (end 0 -> end 1) when leaving this way; -1: either
        const t = e === 0 ? dir : { x: -dir.x, y: -dir.y },
          cr = t.x * (a.y - mid.y) - t.y * (a.x - mid.x)
        cands[e].push({
          d: dir,
          g,
          score,
          left: cr > 1e-9 ? 0 : cr < -1e-9 ? 1 : -1,
        })
      }
      if (!cands[e].length) cands[e] = interior[e]
      if (!cands[e].length)
        throw Error(
          `pair ${label(conns[0].name)}: no free direction to leave its pads at end ${e}`,
        )
    }
    // Leaving a ball pair the other way round swaps which member is on the left, so pick the two
    // directions that agree: a pair whose ends disagree needs one member to cross the other on a via.
    let pick: { c: [any, any]; score: number } | null = null
    for (const c0 of cands[0])
      for (const c1 of cands[1]) {
        const twisted = c0.left >= 0 && c1.left >= 0 && c0.left !== c1.left
        const clashes = (gClash(c0.g) ? 1 : 0) + (gClash(c1.g) ? 1 : 0)
        const score =
          c0.score +
          c1.score -
          (twisted ? cfg.pairTwistCost : 0) -
          clashes * cfg.pairTwistCost
        if (!pick || score > pick.score) pick = { c: [c0, c1], score }
      }
    for (const c of pick!.c) {
      const g = freeG(c.g, c.d)
      claimedG.push(g)
      G.push({ x: wx(gx(g.x)), y: wy(gy(g.y)) })
      d.push(c.d)
    }
    // An unavoidable twist is undone at a ball end (it has via sites), never in front of fanout exits,
    // where the crossing via would wall in the neighbouring exits.
    const exitEnd = [0, 1].map((e) => !padStamps.has(padKey(pads[0][e])))
    const lead = exitEnd[1] && !exitEnd[0] ? 1 : 0
    const leftMember =
      pick!.c[lead].left >= 0
        ? pick!.c[lead].left
        : pick!.c[1 - lead].left >= 0
          ? pick!.c[1 - lead].left
          : 0
    for (const e of [0, 1]) {
      const t = e === 0 ? d[0] : { x: -d[1].x, y: -d[1].y },
        left = { x: -t.y, y: t.x }
      const ml = { x: G[e].x + left.x * H, y: G[e].y + left.y * H },
        mr = { x: G[e].x - left.x * H, y: G[e].y - left.y * H }
      M.push(leftMember === 0 ? [ml, mr] : [mr, ml])
    }
    const bus = busOf(conns[0].name)
    const inner = (e: number) =>
      nodeOf({
        x: G[e].x + d[e].x * cfg.pairLead,
        y: G[e].y + d[e].y * cfg.pairLead,
      })
    const fat: Net = {
      id: `pair:${conns[0].name}`,
      kind: "fat",
      label: `${label(conns[0].name)}+${label(conns[1].name)}`,
      bus,
      src: inner(0),
      dst: inner(1),
      ownPads: conns.flatMap((c: any) => ownCopper.get(c.name) ?? []),
      ignore: [],
      viaCost: Infinity,
      lenWeight: 1,
      above: 12,
      below: 12,
    }
    const info: PairInfo = {
      twisted:
        pick!.c[0].left >= 0 &&
        pick!.c[1].left >= 0 &&
        pick!.c[0].left !== pick!.c[1].left,
      termLayer: LOf(pads[0][0]),
      conns,
      fat,
      stubs: [],
      G: G as [Pt, Pt],
      d: d as [Pt, Pt],
      M: M as any,
      leftMember,
      bus,
    }
    fat.pair = info
    for (const m of [0, 1] as const)
      for (const e of [0, 1] as const) {
        const pad = pads[m][e]
        const st: Net = {
          id: `stub:${conns[m].name}:${e}`,
          kind: "stub",
          label: `${label(conns[m].name)}.${e ? "cpu" : "ram"}`,
          bus,
          src: termNode(pad),
          dst: nodeOf(M[e][m]),
          exact: M[e][m],
          ownPads: [
            ...[padStamps.get(padKey(pad))!].filter(Boolean),
            ...(ownCopper.get(conns[m].name) ?? []),
            // The partner's far-layer via-site reservation guards that ball against other nets.
            // A pair shares one via budget, so a member may pass under its partner's ball: where
            // the two balls stand one behind the other this is the rear member's only straight way out.
            ...partnerReservation(pads[1 - m][e]),
          ],
          ignore: [fat],
          viaCost: cfg.stubViaCost,
          lenWeight: 3,
          above: 0,
          below: 0,
          pair: info,
          member: m,
          end: e,
          conn: conns[m],
        }
        info.stubs.push(st)
        fat.ignore.push(st)
      }
    pairs.push(info)
    nets.push(fat, ...info.stubs)
  }
  // length priority from slack: nets close to their maximum get the direct lanes
  // Criticality: a timing-tight class feels congestion less, so it keeps its direct routes and the
  // classes with slack are the ones that move out of a contested area.
  for (const n of nets) {
    n.cong = cfg.congestionByBus[n.bus?.busId] ?? 1
    n.exactVias = cfg.exactViasByBus[n.bus?.busId]
  }
  for (const n of nets) {
    if (n.kind === "stub") continue
    const ends: [Pt, Pt] =
      n.kind === "single" ? sortedPads(n.conn) : [n.pair!.G[0], n.pair!.G[1]]
    const fixed =
      n.kind === "single"
        ? fixedOf(n.conn.name)
        : Math.max(...n.pair!.conns.map((c: any) => fixedOf(c.name)))
    const slack =
      (cfg.busWindow?.[n.bus?.busId]?.[1] ?? n.bus?.maxLength ?? 1e9) -
      oct(ends[0], ends[1]) -
      fixed
    n.lenWeight = Math.max(
      cfg.minWeight,
      Math.min(cfg.weightMax, cfg.slackK / Math.max(slack, 0.1)),
    )
    if (n.kind === "fat") n.lenWeight = Math.max(n.lenWeight, cfg.pairWeight)
  } // pairs are the most timing-critical: they get the direct route

  // ---------- dynamic occupancy ----------
  const occT = LAYERS.map(() => new Uint8Array(NN)),
    occF = LAYERS.map(() => new Uint8Array(NN)),
    occV = new Uint8Array(NN)
  const histT = LAYERS.map(() => new Float32Array(NN)),
    histV = new Float32Array(NN)
  const mark = new Uint32Array(NN)
  let markGen = 0
  function collect(cells: number[], offs: number[]): number[] {
    markGen++
    const out: number[] = []
    for (const c of cells) {
      const ci = c % NX,
        cj = (c / NX) | 0
      for (let k = 0; k < offs.length; k += 2) {
        const i = ci + offs[k],
          j = cj + offs[k + 1]
        if (i < 0 || j < 0 || i >= NX || j >= NY) continue
        const q = j * NX + i
        if (mark[q] !== markGen) {
          mark[q] = markGen
          out.push(q)
        }
      }
    }
    return out
  }
  const union = (...lists: number[][]) => Int32Array.from(new Set(lists.flat()))
  function stampNet(n: Net, s: number) {
    if (!n.stamp) return
    for (let l = 0; l < NL; l++) {
      for (const c of n.stamp.t[l]) occT[l][c] += s
      for (const c of n.stamp.f[l]) occF[l][c] += s
    }
    for (const c of n.stamp.v) occV[c] += s
    if (n.stamp.lane) {
      const [l, a, b] = n.stamp.lane
      for (let j = Math.max(0, a); j <= Math.min(NY - 1, b); j++)
        occLane[l][j] += s
    }
  }
  function buildStamp(n: Net) {
    const tr: number[][] = perLayer(() => []),
      vias: number[] = [],
      path = n.path!
    for (let k = 0; k < path.length; k++) {
      const id = path[k],
        l = layerOf(id),
        c = id - l * NN
      tr[l].push(c)
      if (k && layerOf(path[k - 1]) !== l) vias.push(c)
    }
    const fat = n.kind === "fat"
    const t = perLayer((l) =>
      union(collect(tr[l], fat ? D.fatT : D.thinT), collect(vias, D.viaT)),
    )
    const f = perLayer((l) =>
      union(collect(tr[l], fat ? D.fatF : D.thinF), collect(vias, D.viaF)),
    )
    const v = union(
      ...perLayer((l) =>
        collect(tr[l], fat ? D.fatV : D.trV).filter(
          (c) => inPadSite[c] !== l,
        ),
      ),
      collect(vias, D.viaV),
    )
    n.stamp = { t, f, v }
    if (n.laneAt !== undefined) {
      const row = ((path[n.laneAt] % NN) / NX) | 0
      n.stamp.lane = [n.laneLayer!, row - n.below - 2, row + n.above + 2]
    }
  }

  // ---------- A* ----------
  const LEN = new Float32Array(Math.max(3, NL) * NN),
    Gs = new Float32Array(Math.max(3, NL) * NN),
    PAR = new Int32Array(Math.max(3, NL) * NN),
    SEEN = new Uint32Array(Math.max(3, NL) * NN),
    DONE = new Uint32Array(Math.max(3, NL) * NN),
    LANE = new Uint8Array(Math.max(3, NL) * NN)
  let gen = 0
  class Heap {
    k: number[] = []
    v: number[] = []
    push(key: number, val: number) {
      const k = this.k,
        v = this.v
      let i = k.length
      k.push(key)
      v.push(val)
      while (i > 0) {
        const p = (i - 1) >> 1
        if (k[p] <= key) break
        k[i] = k[p]
        v[i] = v[p]
        i = p
      }
      k[i] = key
      v[i] = val
    }
    pop(): number {
      const k = this.k,
        v = this.v
      const top = v[0]
      const key = k.pop()!,
        val = v.pop()!
      const n = k.length
      if (n) {
        let i = 0
        for (;;) {
          let c = 2 * i + 1
          if (c >= n) break
          if (c + 1 < n && k[c + 1] < k[c]) c++
          if (k[c] >= key) break
          k[i] = k[c]
          v[i] = v[c]
          i = c
        }
        k[i] = key
        v[i] = val
      }
      return top
    }
    get size() {
      return this.k.length
    }
  }
  const DIRS = [1, 0, 1, 1, 0, 1, -1, 1, -1, 0, -1, -1, 0, -1, 1, -1]
  let presFac = 0.5
  function laneCost(n: Net, l: number, row: number): number {
    const a = row - n.below,
      b = row + n.above
    if (a < 0 || b >= NY) return Infinity
    for (let j = a; j <= b; j++) if (laneBlocked[l][j]) return Infinity
    let occ = 0,
      h = 0
    for (let j = Math.max(0, a - 2); j <= Math.min(NY - 1, b + 2); j++) {
      if (occLane[l][j] > occ) occ = occLane[l][j]
      h += histLane[l][j]
    }
    // an occupied lane is priced like a local crossing, not by its whole length: otherwise the lane
    // order freezes early and two nets that cross near a package can never swap lanes to undo it
    if (cfg.laneConflictLen === null)
      return (
        ((n.cong ?? 1) === 1
          ? laneLen * (n.lenWeight + h / (b - a + 5) + presFac * occ)
          : laneLen *
            (n.lenWeight + n.cong! * (h / (b - a + 5) + presFac * occ))) +
        laneOrderCost(n, l, row)
      )
    return (
      laneLen * (n.lenWeight + h / (b - a + 5)) +
      cfg.laneConflictLen * presFac * occ +
      laneOrderCost(n, l, row)
    )
  }
  // Fanout exits are a fixed, dense column in a fixed order. A net prefers the lane that lines up with
  // its own exit (spread out by `laneSpread`) on the exit's layer, so the nets leave the zone already
  // in exit order and the reordering happens on the open side, where vias are free.
  const exitTerms = origProblem.connections.flatMap((c: any) =>
    c.pointsToConnect.filter(
      (q: any) => !padStamps.has(padKey(q)) && q.x > wx(zXR),
    ),
  )
  const exitMidY = exitTerms.length
    ? (Math.min(...exitTerms.map((q: any) => q.y)) +
        Math.max(...exitTerms.map((q: any) => q.y))) /
      2
    : 0
  function laneOrderCost(n: Net, l: number, row: number): number {
    if (n.ideal === undefined) {
      const ts = (n.kind === "single" ? [n.conn] : n.pair!.conns).flatMap(
        (c: any) => c.pointsToConnect.filter((q: any) => exitTerms.includes(q)),
      )
      n.ideal = ts.length
        ? {
            y:
              exitMidY +
              (ts.reduce((s2: number, q: any) => s2 + q.y, 0) / ts.length -
                exitMidY) *
                cfg.laneSpread,
            layer: n.kind === "single" ? LOf(ts[0]) : -1,
          }
        : null
    }
    if (!n.ideal) return 0
    return (
      cfg.laneOrderCost * Math.abs(wy(row) - n.ideal.y) +
      (n.ideal.layer >= 0 && n.ideal.layer !== l ? cfg.laneLayerCost : 0)
    )
  }
  /** A pair lives on one layer end to end; try both and keep the cheaper (the far layer costs its members a via each end). */
  /** Longest path the search may return for a net: the top of its bus window (members of a pair also carry their stubs). */
  function capOf(n: Net): number {
    if (!cfg.lengthCap || n.kind === "stub") return Infinity
    const bus = n.bus,
      w = cfg.busWindow?.[bus?.busId]
    const top = w
      ? w[1]
      : bus?.minLength !== undefined
        ? bus.maxLength - 0.05
        : bus?.maxLength !== undefined
          ? bus.maxLength - 0.02
          : Infinity
    if (n.kind === "single") return top - 0.1 - fixedOf(n.conn.name)
    const pr = n.pair!,
      stubs = Math.max(
        ...[0, 1].map((m) =>
          pr.stubs[m * 2].path && pr.stubs[m * 2 + 1].path
            ? stubLen(pr.stubs[m * 2]) + stubLen(pr.stubs[m * 2 + 1])
            : 2.4,
        ),
      )
    return (
      top - stubs - 0.4 - Math.max(...pr.conns.map((c: any) => fixedOf(c.name)))
    )
  }
  const routeCapped = (n: Net) => {
    const cap = capOf(n)
    return (cap < Infinity && routeCore(n, cap)) || routeCore(n, Infinity)
  }
  function route(n: Net): boolean {
    if (n.kind === "stub") {
      const L = n.pair!.fat.fatLayer ?? 0
      n.dst = (n.dst % NN) + L * NN
      return routeCore(n, Infinity)
    }
    if (n.kind !== "fat") return routeCapped(n)
    let best: {
      cost: number
      path: number[]
      laneAt?: number
      layer: number
    } | null = null
    // a twisted pair runs on the layer its terminals are NOT on: then each member changes layer once at
    // each end (equal via count) and the two members swap sides for free while one is above the other
    const term = n.pair!.termLayer
    for (const L of n.pair!.twisted || n.exactVias === 2
      ? perLayer((l) => l).filter((l) => l !== term)
      : perLayer((l) => l)) {
      n.fatLayer = L
      n.src = (n.src % NN) + L * NN
      n.dst = (n.dst % NN) + L * NN
      if (!routeCapped(n)) continue
      const cost =
        Gs[n.dst] + (L !== 0 ? cfg.pairFarLayerCost * n.lenWeight : 0)
      if (!best || cost < best.cost)
        best = { cost, path: n.path!, laneAt: n.laneAt, layer: L }
    }
    if (!best) return false
    n.fatLayer = best.layer
    n.path = best.path
    n.laneAt = best.laneAt
    n.laneLayer = best.layer
    n.src = (n.src % NN) + best.layer * NN
    n.dst = (n.dst % NN) + best.layer * NN
    return true
  }
  function routeCore(n: Net, cap: number): boolean {
    gen++
    const heap = new Heap(),
      fat = n.kind === "fat",
      stub = n.kind === "stub",
      cong = n.cong ?? 1
    const sStat = fat ? staticF : staticT,
      sOcc = fat ? occF : occT
    // Exactly two layer changes (top -> bottom -> top): every net of a matched class then carries the
    // same via barrels, so the class is matched through the board as well as on the surface. The search
    // runs on three copies of the grid (before, between and after the two vias).
    const X =
      n.kind === "single" &&
      n.exactVias === 2 &&
      NL === 2 &&
      n.src < NN &&
      n.dst < NN
    const dstId = X ? 2 * NN + n.dst : n.dst
    const ti = (n.dst % NN) % NX,
      tj = ((n.dst % NN) / NX) | 0
    const oct2 = (id: number) => {
      const c = id % NN
      const dx = Math.abs((c % NX) - ti),
        dy = Math.abs(((c / NX) | 0) - tj)
      return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * P
    }
    const hfun = (id: number) => oct2(id) * n.lenWeight
    Gs[n.src] = 0
    LEN[n.src] = 0
    SEEN[n.src] = gen
    PAR[n.src] = -1
    LANE[n.src] = 0
    heap.push(hfun(n.src), n.src)
    // a path that could no longer finish inside the net's length window is not expanded, so over-length
    // detours never appear: the net stays in conflict on its short route and the others have to yield
    const relax = (
      to: number,
      g: number,
      from: number,
      lane: number,
      len: number,
    ) => {
      const L = LEN[from] + len
      if (L + oct2(to) > cap) return
      if (SEEN[to] !== gen || g < Gs[to] - 1e-9) {
        SEEN[to] = gen
        Gs[to] = g
        LEN[to] = L
        PAR[to] = from
        LANE[to] = lane
        heap.push(g + hfun(to), to)
      }
    }
    let found = false
    while (heap.size) {
      const id = heap.pop()
      if (DONE[id] === gen) continue
      DONE[id] = gen
      if (id === dstId) {
        found = true
        break
      }
      const st = (id / NN) | 0,
        l = X ? (st === 1 ? 1 : 0) : st,
        c = id - st * NN,
        i = c % NX,
        j = (c / NX) | 0,
        g = Gs[id]
      const sT = sStat[l],
        oT = sOcc[l],
        hT = histT[l]
      for (let d = 0; d < 16; d += 2) {
        const ni = i + DIRS[d],
          nj = j + DIRS[d + 1]
        if (ni < 0 || nj < 0 || ni >= NX || nj >= NY || inZone(ni)) continue
        const q = nj * NX + ni
        if (sT[q] && q !== n.dst % NN) continue
        // a pair centreline never doubles back where it leaves or joins its terminals: the offset
        // members of a turn sharper than a right angle would fold into each other
        // (a straight reversal has no offset at all and is never allowed; `pairNoFold` also bans the 135 degree turn)
        if (fat && id === n.src) {
          const dd = DIRS[d] * n.pair!.d[0].x + DIRS[d + 1] * n.pair!.d[0].y
          if (
            cfg.pairNoFold
              ? dd < 0
              : dd < 0 &&
                DIRS[d] * n.pair!.d[0].y - DIRS[d + 1] * n.pair!.d[0].x === 0
          )
            continue
        }
        if (fat && q + l * NN === n.dst) {
          const dd = DIRS[d] * n.pair!.d[1].x + DIRS[d + 1] * n.pair!.d[1].y
          if (
            cfg.pairNoFold
              ? dd > 0
              : dd > 0 &&
                DIRS[d] * n.pair!.d[1].y - DIRS[d + 1] * n.pair!.d[1].x === 0
          )
            continue
        }
        const len = DIRS[d] && DIRS[d + 1] ? P * Math.SQRT2 : P
        relax(
          q + st * NN,
          g +
            (cong === 1
              ? len * (n.lenWeight + hT[q] + presFac * oT[q])
              : len * (n.lenWeight + cong * (hT[q] + presFac * oT[q]))),
          id,
          0,
          len,
        )
      }
      if (
        n.viaCost < Infinity &&
        (!staticV[c] || (crowdOpen[c] && staticV[c] === padV[c])) &&
        !inZone(i) &&
        i !== zXL &&
        i !== zXR &&
        (!X || st < 2)
      ) {
        const vc =
          g +
          n.viaCost +
          (crowdedV[c] ? cfg.crowdedViaInPadCost : 0) +
          0.5 * cong * (histV[c] + presFac * occV[c])
        if (X) {
          if (!staticT[1 - l][c]) relax(c + (st + 1) * NN, vc, id, 0, 0)
        } else
          for (let l2 = 0; l2 < NL; l2++)
            if (l2 !== l && !staticT[l2][c]) relax(c + l2 * NN, vc, id, 0, 0)
      }
      if (!stub && i === zXL && !laneBlocked[l][j]) {
        const end = j * NX + zXR
        if (!sStat[l][end]) {
          const cst = laneCost(n, l, j)
          if (cst < Infinity) relax(end + st * NN, g + cst, id, 1, laneLen)
        }
      }
    }
    if (!found) return false
    const path: number[] = []
    let laneTo = -1
    const flat = (id: number) =>
      X ? (id % NN) + (((id / NN) | 0) === 1 ? NN : 0) : id
    for (let id = dstId; id !== -1; id = PAR[id]) {
      path.push(flat(id))
      if (LANE[id] && laneTo < 0) laneTo = flat(id)
    }
    path.reverse()
    // A path that comes back to within less than one clearance of itself (the search exempts a net from
    // its own copper) leaves a same-net sliver. The loop in between is pointless: join the two points
    // directly; the tuning lane gives the length back.
    if (!fat && cfg.unloop) {
      const thin = cfg.w + GAP + 0.02,
        nearVia = cfg.viaD / 2 + cfg.w / 2 + 0.11,
        nearPad = 0.2 + cfg.w / 2 + 0.11
      const Rmax = Math.ceil(Math.max(thin, nearVia, nearPad) / P)
      for (let guard = 0; guard < 60; guard++) {
        const at = new Map<number, number>()
        let cut: [number, number, number[]] | null = null
        const cum: number[] = [0],
          isVia: boolean[] = []
        for (let k = 0; k < path.length; k++) {
          at.set(path[k], k)
          if (k) {
            const u = xy(path[k - 1]),
              v2 = xy(path[k])
            cum.push(cum[k - 1] + Math.hypot(u.x - v2.x, u.y - v2.y))
          }
          isVia.push(
            (k > 0 && path[k - 1] >= NN !== path[k] >= NN) ||
              (k + 1 < path.length && path[k + 1] >= NN !== path[k] >= NN),
          )
        }
        const lane = laneTo >= 0 ? path.indexOf(laneTo) - 1 : -1,
          last = path.length - 1
        outer: for (let a = 0; a < path.length; a++) {
          const ida = path[a],
            la = layerOf(ida),
            ca = ida - la * NN,
            ai = ca % NX,
            aj = (ca / NX) | 0
          for (let dj = -Rmax; dj <= Rmax; dj++)
            for (let di = -Rmax; di <= Rmax; di++) {
              const bi = ai + di,
                bj = aj + dj
              if (bi < 0 || bj < 0 || bi >= NX || bj >= NY) continue
              const b = at.get(bj * NX + bi + la * NN)
              if (b === undefined || b - a < 2) continue
              const chord = Math.hypot(di, dj) * P,
                thr =
                  isVia[a] || isVia[b]
                    ? nearVia
                    : (a === 0 || b === last) && padStamps.size
                      ? nearPad
                      : thin
              if (chord >= thr || cum[b] - cum[a] < 1.2 * chord + 0.015)
                continue // only a real detour between two close points
              if (lane >= a && lane < b) continue
              const link: number[] = []
              let i = ai,
                j = aj,
                ok = true
              while (i !== bi || j !== bj) {
                i += Math.sign(bi - i)
                j += Math.sign(bj - j)
                if (i === bi && j === bj) break
                const q = j * NX + i
                if (
                  sStat[la][q] ||
                  inZone(i) ||
                  (!cfg.linkOnZoneEdge && (i === zXL || i === zXR))
                ) {
                  ok = false
                  break
                }
                link.push(q + la * NN)
              }
              if (!ok) continue
              cut = [a, b, link]
              break outer
            }
        }
        if (!cut) break
        path.splice(cut[0] + 1, cut[1] - cut[0] - 1, ...cut[2])
      }
    }
    // A trace leaves (and reaches) its own via or ball straight out: no curl inside the pad's clearance ring.
    if (!fat && cfg.unloop) {
      const ring = (pad: number) => pad + cfg.w / 2 + 0.1
      const straight = (a: number, b: number): number[] | null => {
        const la = layerOf(path[a]),
          ca = path[a] - la * NN,
          cb = path[b] - la * NN
        let i = ca % NX,
          j = (ca / NX) | 0
        const bi = cb % NX,
          bj = (cb / NX) | 0,
          link: number[] = []
        while (i !== bi || j !== bj) {
          i += Math.sign(bi - i)
          j += Math.sign(bj - j)
          if (i === bi && j === bj) break
          const q = j * NX + i
          if (
            sStat[la][q] ||
            inZone(i) ||
            (!cfg.linkOnZoneEdge && (i === zXL || i === zXR))
          )
            return null
          link.push(q + la * NN)
        }
        return link
      }
      for (let pass = 0; pass < 2; pass++) {
        // forward: leaving; second pass on the reversed path: arriving
        for (let a = 0; a < path.length - 2; a++) {
          const la = layerOf(path[a])
          const isTerm = a === 0,
            afterVia = a > 0 && layerOf(path[a - 1]) !== la
          if (!isTerm && !afterVia) continue
          const r = ring(isTerm ? 0.2 : cfg.viaD / 2),
            pa = xy(path[a])
          let b = a
          for (let k = a + 1; k < Math.min(path.length, a + 16); k++) {
            if (layerOf(path[k]) !== la) break
            const q = xy(path[k])
            if (Math.hypot(q.x - pa.x, q.y - pa.y) <= r + 1e-9) b = k
          }
          if (b - a < 2) continue
          const lane = laneTo >= 0 ? path.indexOf(laneTo) - 1 : -1
          if (lane >= a && lane < b) continue
          const link = straight(a, b)
          if (!link || link.length >= b - a - 1) continue
          path.splice(a + 1, b - a - 1, ...link)
        }
        path.reverse()
      }
    }
    n.path = path
    if (laneTo >= 0) {
      n.laneAt = path.indexOf(laneTo) - 1
      n.laneLayer = layerOf(laneTo)
    } else {
      n.laneAt = undefined
      n.laneLayer = undefined
    }
    return true
  }
  function withExemptions<T>(n: Net, fn: () => T): T {
    stampNet(n, -1)
    for (const o of n.ignore) stampNet(o, -1)
    for (const st of n.ownPads) applyPad(st, -1)
    const r = fn()
    for (const st of n.ownPads) applyPad(st, +1)
    for (const o of n.ignore) stampNet(o, +1)
    stampNet(n, +1)
    return r
  }
  function ripAndRoute(n: Net): boolean {
    stampNet(n, -1)
    for (const o of n.ignore) stampNet(o, -1)
    for (const st of n.ownPads) applyPad(st, -1)
    const ok = route(n)
    if (!ok && cfg.debugNoPath) {
      const d = (id: number) => {
        const l = layerOf(id),
          c = id - l * NN,
          q = xy(c)
        return `${LAYERS[l][0]}(${q.x.toFixed(2)},${q.y.toFixed(2)}) T=${staticT[l][c]} F=${staticF[l][c]} V=${staticV[c]} occT=${occT[l][c]}`
      }
      log(
        `NOPATH ${n.label} kind=${n.kind} src ${d(n.src)} dst ${d(n.dst)} own=${n.ownPads.length} viaCost=${n.viaCost}`,
      )
    }
    for (const st of n.ownPads) applyPad(st, +1)
    for (const o of n.ignore) stampNet(o, +1)
    if (ok) buildStamp(n)
    else n.stamp = undefined
    stampNet(n, +1)
    return ok
  }
  function conflictsOf(n: Net, bumpHist: number): number {
    if (!n.path) return 1
    return withExemptions(n, () => {
      let cnt = 0
      const path = n.path!,
        occ = n.kind === "fat" ? occF : occT
      for (let k = 0; k < path.length; k++) {
        const id = path[k],
          l = layerOf(id),
          c = id - l * NN
        if (occ[l][c]) {
          cnt++
          histT[l][c] += bumpHist
        }
        if (k && layerOf(path[k - 1]) !== l && occV[c]) {
          cnt++
          histV[c] += bumpHist
        }
      }
      if (n.stamp?.lane) {
        const [l, a, b] = n.stamp.lane
        let hit = false
        for (let j = Math.max(0, a); j <= Math.min(NY - 1, b); j++)
          if (occLane[l][j]) {
            hit = true
            histLane[l][j] += bumpHist * 0.5
          }
        if (hit) cnt++
      }
      return cnt
    })
  }
  const xy = (id: number): Pt => ({
    x: wx((id % NN) % NX),
    y: wy(((id % NN) / NX) | 0),
  })
  const plen = (pts: Pt[]) =>
    pts.reduce(
      (s, p, i) =>
        i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0,
      0,
    )
  const viaCount = (n: Net) => {
    let v = 0
    const p = n.path ?? []
    for (let k = 1; k < p.length; k++) if (p[k] >= NN !== p[k - 1] >= NN) v++
    return v
  }

  // ---------- geometry ----------
  function bump(
    x: number,
    y: number,
    a: number,
    dir: number,
    W = BW,
    ch = CH,
  ): Pt[] {
    const c = Math.min(ch, a / 2)
    return [
      { x: x - c, y },
      { x, y: y + dir * c },
      { x, y: y + dir * (a - c) },
      { x: x + c, y: y + dir * a },
      { x: x + W - c, y: y + dir * a },
      { x: x + W, y: y + dir * (a - c) },
      { x: x + W, y: y + dir * c },
      { x: x + W + c, y },
    ]
  }
  function simplify(pts: Pt[]): Pt[] {
    const out: Pt[] = []
    for (const p of pts) {
      const m = out.length
      if (m && Math.hypot(out[m - 1].x - p.x, out[m - 1].y - p.y) < 1e-9)
        continue
      if (m >= 2) {
        const a = out[m - 2],
          b = out[m - 1]
        const cr = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x),
          dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y)
        if (Math.abs(cr) < 1e-9 && dot >= 0) {
          out[m - 1] = p
          continue
        }
      }
      out.push(p)
    }
    return out
  }
  /** Offset of a polyline by d (left of travel for d > 0), mitred. An outer corner sharper than 45
   *  degrees reaches |d| / cos(turn / 2) from the centreline, beyond the clearance the centreline
   *  reserved; `bevel(i)` selects such corners to bevel instead (no point then lies farther than |d|).
   *  `from[i]` is the index in the result of the (first) point offset from pts[i]; `sharp` lists the
   *  sharp outer corners as [vertex index, mitre point]. */
  function offsetPolyline(
    pts: Pt[],
    d: number,
    bevel: (i: number) => boolean = () => false,
  ): Pt[] & { from: number[]; sharp: [number, Pt][] } {
    const out = [] as unknown as Pt[] & {
      from: number[]
      sharp: [number, Pt][]
    }
    out.from = []
    out.sharp = []
    const nrm = (a: Pt, b: Pt) => {
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      return { x: -(b.y - a.y) / L, y: (b.x - a.x) / L }
    }
    for (let i = 0; i < pts.length; i++) {
      out.from.push(out.length)
      if (i === 0 || i === pts.length - 1) {
        const n = i === 0 ? nrm(pts[0], pts[1]) : nrm(pts[i - 1], pts[i])
        out.push({ x: pts[i].x + n.x * d, y: pts[i].y + n.y * d })
        continue
      }
      const n1 = nrm(pts[i - 1], pts[i]),
        n2 = nrm(pts[i], pts[i + 1]),
        cos = n1.x * n2.x + n1.y * n2.y,
        // left turn: n1 x n2 > 0; the offset is on the outside when it lies right of a left turn
        turn = n1.x * n2.y - n1.y * n2.x
      const k = d / (1 + cos),
        mitre = {
          x: pts[i].x + (n1.x + n2.x) * k,
          y: pts[i].y + (n1.y + n2.y) * k,
        }
      if (cos < Math.SQRT1_2 - 1e-6 && turn * d < 0) {
        out.sharp.push([i, mitre])
        if (bevel(i)) {
          out.push({ x: pts[i].x + n1.x * d, y: pts[i].y + n1.y * d })
          out.push({ x: pts[i].x + n2.x * d, y: pts[i].y + n2.y * d })
          continue
        }
      }
      out.push(mitre)
    }
    return out
  }
  /** Single-trace centreline (pad to pad on the grid) split at its lane. */
  function singleParts(n: Net) {
    const p = n.path!,
      a = p.slice(0, n.laneAt! + 1),
      b = p.slice(n.laneAt! + 1)
    return { a, b }
  }
  const pathLen = (ids: number[]) => {
    let s = 0
    for (let k = 1; k < ids.length; k++) {
      const u = xy(ids[k - 1]),
        v = xy(ids[k])
      s += Math.hypot(u.x - v.x, u.y - v.y)
    }
    return s
  }
  /** Bump count and amplitude that add `e` to a single lane (shared by the strip reservation and the emitted copper). */
  function singleBumps(e: number): { k: number; a: number } {
    const k = Math.max(1, Math.min(kSingle, Math.ceil(e / bumpExtra(0.3))))
    return { k, a: bumpAmp(e / k) }
  }
  function singleLane(xL: number, xR: number, y: number, e: number): Pt[] {
    const pts: Pt[] = [{ x: xL, y }]
    if (e > 1e-6) {
      const { k, a } = singleBumps(e),
        span = k * BW + (k - 1) * BG,
        x0 = xL + (xR - xL - span) / 2
      for (let b = 0; b < k; b++)
        pts.push(...bump(x0 + b * (BW + BG), y, a, +1))
    }
    pts.push({ x: xR, y })
    return pts
  }
  /** Pair centreline end to end; `ec` of coupled extra length is added in the lane. */
  function pairCentre(n: Net, ec: number): Pt[] {
    const pr = n.pair!,
      p = n.path!,
      la = n.laneAt!
    const head = p.slice(0, la + 1).map(xy),
      tail = p.slice(la + 1).map(xy),
      y = head.at(-1)!.y,
      xL = head.at(-1)!.x
    const laneBumps: Pt[] = []
    if (ec > 0) {
      let k = Math.max(
          1,
          Math.min(kPair, Math.round(ec / bumpExtra(0.9, PCH))),
        ),
        a = bumpAmp(ec / k, PCH)
      if (a < PAIR_MIN_AMP) {
        k = 1
        a = Math.max(PAIR_MIN_AMP, bumpAmp(ec, PCH))
      }
      for (let b = 0; b < k; b++)
        laneBumps.push(
          ...bump(xL + TRIM_LEN + 0.4 + b * (PW + PG), y, a, +1, PW, PCH),
        )
    }
    return [
      pr.G[0],
      ...head,
      { x: xL + 0.3, y },
      ...laneBumps,
      ...tail,
      pr.G[1],
    ]
  }
  function unknot(pts: Pt[], keepPt?: Pt): Pt[] {
    if (!cfg.unknot) return pts
    const out = [...pts]
    for (let i = 0; i < out.length - 2; i++) {
      let run = 0,
        cut = -1
      for (let j = i + 1; j < Math.min(out.length, i + 9); j++) {
        run += Math.hypot(out[j].x - out[j - 1].x, out[j].y - out[j - 1].y)
        if (out[j] === keepPt || (out[j - 1] === keepPt && j - 1 > i)) break
        const chord = Math.hypot(out[j].x - out[i].x, out[j].y - out[i].y)
        if (run > 0.8) break
        if (j > i + 1 && chord < 0.3 && run > 1.5 * chord + 0.05) cut = j
      }
      if (cut > 0) out.splice(i + 1, cut - i - 1)
    }
    return out
  }
  function pairMembers(
    n: Net,
    ec: number,
    trims: [number, number],
  ): { pts: [Pt[], Pt[]]; ok: boolean; sharp: [string, Pt][][] } {
    const pr = n.pair!,
      centre = pairCentre(n, ec),
      xL = xy(n.path![n.laneAt!]).x
    const keep = (pts: Pt[]) =>
      pts.filter(
        (q, i) =>
          i === 0 || Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) > 1e-9,
      )
    const yL = xy(n.path![n.laneAt!]).y,
      isTrim = (q: Pt) =>
        Math.abs(q.x - (xL + 0.3)) < 1e-9 && Math.abs(q.y - yL) < 1e-9
    // drop collinear grid nodes (a mitred offset of a 1-cell segment would backtrack), keeping the trim anchor
    const c1 = keep(centre),
      c2 = c1.filter((q, i) => {
        if (i === 0 || i === c1.length - 1 || isTrim(q)) return true
        const a = c1[i - 1],
          b = c1[i + 1],
          cr = (q.x - a.x) * (b.y - q.y) - (q.y - a.y) * (b.x - q.x),
          dot = (q.x - a.x) * (b.x - q.x) + (q.y - a.y) * (b.y - q.y)
        return !(Math.abs(cr) < 1e-9 && dot > 0)
      })
    const iTrim = c2.findIndex(
      (q) =>
        Math.abs(q.x - (xL + 0.3)) < 1e-9 &&
        Math.abs(q.y - xy(n.path![n.laneAt!]).y) < 1e-9,
    )
    // straight centreline after the lane start, measured along +x from xL to the next turn
    const runAfterTrim =
      iTrim >= 0 &&
      iTrim + 1 < c2.length &&
      Math.abs(c2[iTrim + 1].y - c2[iTrim].y) < 1e-9 &&
      c2[iTrim + 1].x > c2[iTrim].x
        ? c2[iTrim + 1].x - xL
        : 0
    let ok = true
    const vkey = (q: Pt) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`
    const sharp: [string, Pt][][] = [[], []]
    const out = [0, 1].map((m) => {
      const side = m === pr.leftMember ? +1 : -1
      const raw = offsetPolyline(c2, side * H, (i) =>
        !!n.bevel?.[m].has(vkey(c2[i])),
      )
      for (const [i, q] of raw.sharp)
        if (!n.bevel?.[m].has(vkey(c2[i]))) sharp[m].push([vkey(c2[i]), q])
      const anchor = iTrim >= 0 ? raw[raw.from[iTrim]] : undefined
      // On the inside of a sharp turn the offset folds into a tiny knot: take the chord instead (the
      // length it saves is given back by the member's trim).
      let poly = unknot(raw, anchor)
      const iT = anchor ? poly.indexOf(anchor) : -1
      const e = trims[m]
      if (e > 1e-6) {
        // the bumps must end before the centreline's next turn, clear of both members' corners there
        const kFit = Math.min(
          3,
          Math.floor((runAfterTrim - 0.35 - cfg.w / 2 - GAP - H) / 0.5 + 1e-9),
        )
        let k = 1
        while (k < kFit && bumpAmp(e / k, 0.1) > 0.4) k++
        const a = bumpAmp(e / k, 0.1)
        if (a > TRIM - 0.02 || iT < 0 || kFit < 1) ok = false
        const y = poly[iT]?.y ?? 0,
          ins: Pt[] = []
        for (let b = 0; b < k; b++)
          ins.push(...bump(xL + 0.5 + b * 0.5, y, a, side, 0.25, 0.1))
        poly = [...poly.slice(0, iT + 1), ...ins, ...poly.slice(iT + 1)]
      }
      return poly
    }) as [Pt[], Pt[]]
    return { pts: out, ok, sharp }
  }
  const stubLen = (st: Net) =>
    st.path
      ? pathLen(st.path) +
        Math.hypot(
          xy(st.path.at(-1)!).x - st.exact!.x,
          xy(st.path.at(-1)!).y - st.exact!.y,
        )
      : Infinity
  /** Where a member's stub meets its offset line the two can form a hairpin (the stub runs out to the
   *  gather point and the member comes straight back). Drop the points of that hairpin so the stub runs
   *  directly onto the member; lengths and emitted copper both use this joined form. */
  function joinMember(
    n: Net,
    k: number,
    memIn: Pt[],
  ): { a: number[]; mem: Pt[]; b: number[]; len: number } {
    const pr = n.pair!,
      a = [...pr.stubs[k * 2].path!],
      b = [...pr.stubs[k * 2 + 1].path!]
    let mem = [...memIn]
    // micro-segments at the ends (offset rounding) would hide the real turn
    if (cfg.joinStubs) {
      while (
        mem.length > 6 &&
        Math.hypot(mem[1].x - mem[0].x, mem[1].y - mem[0].y) < 0.05
      )
        mem.splice(1, 1)
      while (
        mem.length > 6 &&
        Math.hypot(
          mem.at(-2)!.x - mem.at(-1)!.x,
          mem.at(-2)!.y - mem.at(-1)!.y,
        ) < 0.05
      )
        mem.splice(-2, 1)
    }
    const ang = (p: Pt, j: Pt, q: Pt) => {
      const u = [p.x - j.x, p.y - j.y],
        v = [q.x - j.x, q.y - j.y],
        lu = Math.hypot(u[0], u[1]),
        lv = Math.hypot(v[0], v[1])
      return lu < 1e-6 || lv < 1e-6
        ? 180
        : (Math.acos(
            Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv))),
          ) *
            180) /
            Math.PI
    }
    const sameLayer = (ids: number[]) =>
      ids.length >= 2 && ids.at(-1)! >= NN === ids.at(-2)! >= NN
    if (cfg.joinStubs)
      for (const [ids, front] of [
        [a, true],
        [b, false],
      ] as [number[], boolean][])
        for (let g = 0; g < 6; g++) {
          const m0 = front ? mem[0] : mem.at(-1)!,
            m1 = front ? mem[1] : mem.at(-2)!,
            e = xy(ids.at(-1)!)
          if (mem.length < 6 || !m1) break
          if (Math.hypot(e.x - m0.x, e.y - m0.y) < 0.08) {
            // stub ends on the member's first point: is the turn there a hairpin?
            if (!sameLayer(ids) || ang(xy(ids.at(-2)!), m0, m1) >= 100) break
            ids.pop()
            if (front) mem.shift()
            else mem.pop()
            continue
          }
          if (ang(e, m0, m1) < 100) {
            if (front) mem.shift()
            else mem.pop()
            continue
          }
          if (sameLayer(ids) && ang(xy(ids.at(-2)!), e, m0) < 100) {
            ids.pop()
            continue
          }
          break
        }
    // the member must not come back past the via its stub arrived through: run straight from the via to
    // the first member point that is outside the via's clearance ring
    if (cfg.joinStubs)
      for (const [ids, front] of [
        [a, true],
        [b, false],
      ] as [number[], boolean][]) {
        let vi = -1
        for (let k = ids.length - 1; k > 0; k--)
          if (ids[k] >= NN !== ids[k - 1] >= NN) {
            vi = k
            break
          }
        if (vi < 0) continue
        const v = xy(ids[vi]),
          ring = cfg.viaD / 2 + cfg.w / 2 + 0.1,
          pts = front ? mem : [...mem].reverse()
        const dseg = (p: Pt, q: Pt) => {
          const vx = q.x - p.x,
            vy = q.y - p.y,
            L = vx * vx + vy * vy
          let t = L ? ((v.x - p.x) * vx + (v.y - p.y) * vy) / L : 0
          t = Math.max(0, Math.min(1, t))
          return Math.hypot(v.x - p.x - t * vx, v.y - p.y - t * vy)
        }
        let keep = 0,
          run = 0
        for (let k = 1; k < Math.min(pts.length - 3, 10); k++) {
          run += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y)
          if (run > 1.6) break
          if (
            dseg(pts[k - 1], pts[k]) < ring &&
            Math.hypot(pts[k].x - v.x, pts[k].y - v.y) >= ring
          )
            keep = k
        }
        if (!keep) continue
        ids.length = vi + 1 // the stub ends at its via
        if (front) mem = mem.slice(keep)
        else mem = mem.slice(0, mem.length - keep)
      }
    const ea = xy(a.at(-1)!),
      eb = xy(b.at(-1)!)
    const len =
      pathLen(a) +
      Math.hypot(ea.x - mem[0].x, ea.y - mem[0].y) +
      plen(mem) +
      Math.hypot(eb.x - mem.at(-1)!.x, eb.y - mem.at(-1)!.y) +
      pathLen(b) +
      fixedOf(pr.conns[k].name)
    return { a, mem, b, len }
  }
  /** Lengths of the two members with no added tuning. */
  function pairBase(n: Net): [number, number] {
    const m = pairMembers(n, 0, [0, 0]).pts
    return [0, 1].map((k) => joinMember(n, k, m[k]).len) as [number, number]
  }
  /** Coupled extra plus per-member trims that bring both members to `target`. */
  function pairTune(
    n: Net,
    target: number,
  ): { ec: number; trims: [number, number]; amp: number; ok: boolean } {
    const need = (ec: number) => {
      const m = pairMembers(n, ec, [0, 0]).pts
      return [0, 1].map((k) => target - joinMember(n, k, m[k]).len)
    }
    let ec = 0
    const n0 = need(0),
      want = Math.min(n0[0], n0[1])
    if (want >= PAIR_MIN_EXTRA + 0.02) {
      let lo = PAIR_MIN_EXTRA,
        hi = want + 1
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2,
          r = need(mid)
        if (Math.min(r[0], r[1]) > 0.004) lo = mid
        else hi = mid
      }
      ec = lo
    }
    const r = need(ec),
      trims: [number, number] = [Math.max(0, r[0]), Math.max(0, r[1])]
    const k =
      ec > 0
        ? Math.max(1, Math.min(kPair, Math.round(ec / bumpExtra(0.9, PCH))))
        : 0
    const amp = ec > 0 ? Math.max(PAIR_MIN_AMP, bumpAmp(ec / k, PCH)) : 0
    const mem = pairMembers(n, ec, trims)
    // a centreline that reverses on itself has no valid offset: such geometry never counts as tuned
    const sane = mem.pts.every((pl) =>
      pl.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)),
    )
    return {
      ec,
      trims,
      amp,
      ok: sane && r[0] > -0.01 && r[1] > -0.01 && mem.ok,
    }
  }

  // ---------- targets ----------
  /** `settled`: no net is in conflict, so the geometry is final enough to judge clearances on. */
  function evaluate(settled = false): {
    ok: boolean
    msgs: string[]
    over: Net[]
    changed: Net[]
    untunable: Net[]
  } {
    const msgs: string[] = [],
      over: Net[] = [],
      changed: Net[] = [],
      untunable: Net[] = []
    let ok = true
    const routable = nets.filter((n) => n.kind !== "stub" && n.active)
    const tuned = new Map<Net, ReturnType<typeof pairTune>>()
    for (const n of routable) {
      if (
        !n.path ||
        n.laneAt === undefined ||
        (n.kind === "fat" && n.pair!.stubs.some((s) => !s.path))
      ) {
        n.base = Infinity
        ok = false
        continue
      }
      n.base =
        n.kind === "single"
          ? pathLen(singleParts(n).a) +
            laneLen +
            pathLen(singleParts(n).b) +
            fixedOf(n.conn.name)
          : Math.max(...pairBase(n))
      // broken geometry (a pair centreline that reverses on itself) must never pass as routed
      if (Number.isNaN(n.base)) {
        n.base = Infinity
        ok = false
        msgs.push(`${n.label} has no valid geometry`)
        if (n.kind === "fat") untunable.push(n)
      }
    }
    for (const bus of srj.buses ?? []) {
      const ms = routable.filter((n) => n.bus === bus)
      if (!ms.length) continue
      let top: number, lo: number
      if (cfg.busWindow?.[bus.busId]) [lo, top] = cfg.busWindow[bus.busId]
      else if (bus.minLength !== undefined) {
        top = bus.maxLength - 0.05
        lo = Math.max(
          bus.minLength + cfg.windowMargin,
          top - (bus.maxLengthSkew ?? Infinity) + cfg.skewMargin,
        )
      } else if (bus.maxLength !== undefined) {
        top = bus.maxLength - 0.02
        lo = top - (bus.maxLengthSkew ?? 0.635) + cfg.skewMargin
      } else {
        const skew = bus.maxLengthSkew ?? 0.635,
          bases = ms.map((n) => n.base!).filter(Number.isFinite)
        // The window sits where the members need the least work: length added to the short ones
        // plus, weighted heavier, length the long ones must lose. Pinning it to the longest member
        // makes one detour lengthen every other member of the bus, and the taller tuning strips
        // that takes push more members onto detours.
        const cost = (t: number) =>
          bases.reduce(
            (s2, b) =>
              s2 +
              Math.max(0, t - skew - b) +
              cfg.overLengthWeight * Math.max(0, b - t),
            0,
          )
        // frozen members bound the window: top >= the longest, top - skew <= the shortest
        const frozen = (bus.connectionNames as string[])
            .filter((name) => !routedNames.has(name))
            .map((name) => frozenLen.get(name))
            .filter((v): v is number => v !== undefined && v > 0),
          fMin = Math.min(...frozen) + skew - cfg.skewMargin - 0.04,
          fMax = Math.max(...frozen),
          clamp = (t: number) =>
            frozen.length && fMax <= fMin ? Math.min(Math.max(t, fMax), fMin) : t
        let best = clamp(Math.max(...bases))
        for (const b of bases)
          for (const t of [b, b + skew].map(clamp))
            if (cost(t) < cost(best) - 1e-9) best = t
        top = best + 0.02
        lo = top - skew + cfg.skewMargin
      }
      for (const n of ms) {
        n.top = top
        n.lo = lo
        if (n.base! > top + 1e-6) {
          ok = false
          over.push(n)
          n.lenWeight = Math.min(n.lenWeight * cfg.weightGrow, cfg.weightMax)
        }
        n.target = Math.max(Math.min(n.base!, top), lo)
      }
    }
    for (const n of routable) {
      if (n.target === undefined || !Number.isFinite(n.base!)) {
        n.target ??= n.base
        continue
      }
      if (n.kind === "single") {
        const e = n.target - n.base!,
          need =
            e <= 1e-6
              ? 0
              : Math.max(
                  0,
                  Math.ceil((singleBumps(e).a + 0.004 + LP) / P - 1e-9) - 5,
                )
        if (need > n.above || n.above - need > 2) {
          if (need > n.above) ok = false
          msgs.push(`${n.label} strip ${n.above}->${need}`)
          n.above = need
          changed.push(n)
        }
      } else {
        const t = pairTune(n, n.target)
        tuned.set(n, t)
        if (!t.ok) {
          ok = false
          msgs.push(
            `${n.label} pair cannot be tuned (trims ${t.trims.map((x) => x.toFixed(2)).join("/")})`,
          )
          // the members' stubs differ by more than a trim can absorb: the stubs take the short way with rising priority
          untunable.push(n)
        }
        const side = Math.ceil((H + TRIM + 0.06) / P),
          up = Math.ceil((H + Math.max(t.amp, TRIM) + 0.06) / P)
        if (up > n.above || n.above - up > 2 || side !== n.below) {
          if (up > n.above || side > n.below) ok = false
          msgs.push(`${n.label} pair strip ${n.above}->${up}`)
          n.above = up
          n.below = side
          changed.push(n, ...n.pair!.stubs)
        }
      }
    }
    // A pair member's outer mitre at a sharp corner reaches past the clearance its centreline reserved.
    // Once nothing is in conflict, a corner whose mitre comes too close to another net's copper is
    // bevelled (which only removes copper) and the pair is re-tuned; every other corner keeps its mitre.
    const fats = routable.filter((n) => n.kind === "fat" && tuned.has(n))
    if (settled && fats.length) {
      const memOf = new Map<Net, [Pt[], Pt[]]>()
      const sharpOf = new Map<Net, [string, Pt][][]>()
      for (const n of fats) {
        const t = tuned.get(n)!,
          r = pairMembers(n, t.ec, t.trims),
          // the copper actually emitted: each member joined onto its stubs (hairpins dropped)
          joined = [0, 1].map((k) => joinMember(n, k, r.pts[k]).mem) as [
            Pt[],
            Pt[],
          ]
        memOf.set(n, joined)
        sharpOf.set(
          n,
          r.sharp.map((list, k) =>
            list.filter(([, q]) =>
              joined[k].some((j) => Math.hypot(j.x - q.x, j.y - q.y) < 1e-9),
            ),
          ),
        )
      }
      const segD = (p: Pt, ax: number, ay: number, bx: number, by: number) => {
        const dx = bx - ax,
          dy = by - ay,
          L = dx * dx + dy * dy,
          k = L
            ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / L))
            : 0
        return Math.hypot(p.x - ax - k * dx, p.y - ay - k * dy)
      }
      const polyD = (p: Pt, pl: Pt[]) => {
        let m = Infinity
        for (let i = 1; i < pl.length; i++)
          m = Math.min(m, segD(p, pl[i - 1].x, pl[i - 1].y, pl[i].x, pl[i].y))
        return m
      }
      // distance from p to a routed path's copper centreline on layer l (its vias counted by their rim)
      const pathD = (p: Pt, ids: number[], l: number) => {
        let m = Infinity
        for (let i = 1; i < ids.length; i++) {
          const la = layerOf(ids[i - 1]),
            lb = layerOf(ids[i]),
            a = xy(ids[i - 1] - la * NN),
            b = xy(ids[i] - lb * NN)
          if (la === l && lb === l) m = Math.min(m, segD(p, a.x, a.y, b.x, b.y))
          else if (la !== lb)
            m = Math.min(
              m,
              Math.hypot(p.x - a.x, p.y - a.y) - cfg.viaD / 2 + cfg.w / 2,
            )
        }
        return m
      }
      const padClear = srj.minTraceToPadEdgeClearance ?? 0.12
      const clashes = (n: Net, p: Pt) => {
        const l = n.fatLayer ?? 0,
          own = new Set(
            n.pair!.conns.flatMap((c: any) => c.pointsToConnect.map(padKey)),
          )
        for (const o of fats)
          if (o !== n && (o.fatLayer ?? 0) === l)
            for (const pl of memOf.get(o)!)
              if (polyD(p, pl) < cfg.w + GAP - 1e-6) return true
        for (const o of nets) {
          if (o === n || !o.active || !o.path || o.kind === "fat") continue
          if (o.kind === "stub" && n.pair!.stubs.includes(o)) continue
          if (pathD(p, o.path, l) < cfg.w + GAP - 1e-6) return true
        }
        for (const g of frozenSegs[l])
          if (segD(p, g[0], g[1], g[2], g[3]) < cfg.w / 2 + g[4] + GAP - 1e-6)
            return true
        for (const g of frozenVias)
          if (Math.hypot(p.x - g[0], p.y - g[1]) < cfg.w / 2 + g[2] + GAP - 1e-6)
            return true
        for (const o of srj.obstacles) {
          if (
            o.isCopperPour ||
            !o.layers.includes(LAYERS[l]) ||
            own.has(padKey(o.center))
          )
            continue
          const dx = Math.abs(p.x - o.center.x),
            dy = Math.abs(p.y - o.center.y),
            hx = Math.abs(o.width) / 2,
            hy = Math.abs(o.height) / 2
          if (dx > hx + 1 || dy > hy + 1) continue
          const d =
            o.shape === "circle"
              ? Math.hypot(dx, dy) - hx
              : Math.hypot(Math.max(0, dx - hx), Math.max(0, dy - hy))
          if (d < cfg.w / 2 + padClear - 1e-6) return true
        }
        return false
      }
      for (const n of fats)
        sharpOf.get(n)!.forEach((list, m) => {
          for (const [k, p] of list)
            if (clashes(n, p)) {
              n.bevel ??= [new Set(), new Set()]
              n.bevel[m].add(k)
              ok = false
              msgs.push(`${n.label} bevels a corner at ${k}`)
            }
        })
    }
    return { ok, msgs, over, changed, untunable }
  }

  // ---------- endgame ----------
  // Negotiation cannot undo a deadlock that needs several nets to move together (two nets crossing
  // under a package, one of them at its length cap). So when only a few nets are left in conflict, that
  // small neighbourhood is ripped up and re-placed one net at a time with hard blocking, trying many
  // orders (tightest first, then shuffles) until one order fits them all. Everything else stays put.
  function finish(conflicted: Net[]): boolean {
    const spots: Pt[] = []
    for (const n of conflicted) {
      if (!n.path) continue
      withExemptions(n, () => {
        const occ = n.kind === "fat" ? occF : occT
        for (const id of n.path!) {
          const l = layerOf(id),
            c = id - l * NN
          if (occ[l][c]) spots.push(xy(c))
        }
      })
    }
    const R = cfg.finishRadius,
      dist = (n: Net) => {
        let best = Infinity
        if (!n.path) return 0
        for (let k = 0; k < n.path.length; k += 3) {
          const p = xy(n.path[k])
          for (const q of spots) {
            const d = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y))
            if (d < best) best = d
          }
        }
        return best
      }
    const singles = nets.filter((n) => n.active && n.kind === "single")
    if (conflicted.some((n) => n.kind !== "single")) return false
    const near = singles
      .filter((n) => !conflicted.includes(n))
      .map((n) => ({ n, d: dist(n) }))
      .filter((e) => e.d < R)
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.max(0, cfg.finishMax - conflicted.length))
      .map((e) => e.n)
    const S = [...conflicted, ...near]
    const saved = S.map((n) => ({
      n,
      path: n.path,
      laneAt: n.laneAt,
      laneLayer: n.laneLayer,
      stamp: n.stamp,
    }))
    const slack = (n: Net) => capOf(n) - oct(...sortedPads(n.conn))
    const oldPres = presFac
    let bestPlaced = 0
    for (let t = 0; t < cfg.finishTries; t++) {
      for (const n of S) {
        stampNet(n, -1)
        n.stamp = undefined
      }
      const order =
        t === 0
          ? [...S].sort((a, b) => slack(a) - slack(b))
          : t === 1
            ? [...conflicted, ...near]
            : S.map((n) => ({ n, k: rng() }))
                .sort((a, b) => a.k - b.k)
                .map((e) => e.n)
      presFac = 1e5
      let placed = 0
      for (const n of order) {
        if (!ripAndRoute(n) || conflictsOf(n, 0)) break
        placed++
      }
      presFac = oldPres
      if (placed > bestPlaced) bestPlaced = placed
      if (placed === S.length) {
        log(
          `  endgame: ${S.length} nets (${conflicted.length} in conflict) re-placed in order ${t}`,
        )
        return true
      }
    }
    for (const n of S) {
      stampNet(n, -1)
      n.stamp = undefined
    }
    for (const e of saved) {
      e.n.path = e.path
      e.n.laneAt = e.laneAt
      e.n.laneLayer = e.laneLayer
      e.n.stamp = e.stamp
      stampNet(e.n, +1)
    }
    log(
      `  endgame: no order fits ${S.length} nets (best ${bestPlaced}) in ${cfg.finishTries} tries`,
    )
    return false
  }

  // ---------- negotiation ----------
  // A different seed gives a different (deterministic) routing order: a cheap, independent retry.
  let rngState = (cfg.seed * 2654435761) >>> 0
  const rng = () => {
    rngState =
      (Math.imul(rngState ^ (rngState >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    return rngState / 4294967296
  }
  const shuffled = cfg.seed
    ? nets
        .map((n) => ({ n, k: rng() }))
        .sort((a, b) => a.k - b.k)
        .map((e) => e.n)
    : [...nets]
  const order = shuffled.sort(
    (a, b) =>
      ({ fat: 0, stub: 1, single: 2 })[a.kind] -
      { fat: 0, stub: 1, single: 2 }[b.kind],
  )
  function negotiate(): boolean {
    // Only nets that are in conflict (or whose reservation changed) are ripped up: re-routing settled
    // nets every round makes crossing pairs swap places for ever instead of one of them taking a via.
    let dirty: Set<Net> | null = null,
      best = Infinity,
      bestAt = 0,
      kicks = 0,
      phase = 0,
      lastFinish = -1e9
    const phases: string[][] = cfg.phases?.length
      ? cfg.phases
      : [srj.connections.map((c: any) => c.name)]
    {
      const first = new Set(phases[0])
      for (const n of nets)
        n.active = (
          n.pair ? n.pair.conns.map((c: any) => c.name) : [n.conn.name]
        ).some((x: string) => first.has(x))
    }
    for (let it = 0; it < cfg.maxIters; it++) {
      iterations = it + 1
      for (const n of order)
        if (n.active && (!dirty || dirty.has(n)))
          if (!ripAndRoute(n)) log(`  no path for ${n.label}`)
      let total = 0
      const bad: string[] = []
      dirty = new Set()
      for (const n of nets) {
        if (!n.active) continue
        const c = conflictsOf(n, cfg.histInc)
        if (c) {
          total += c
          bad.push(n.label)
          dirty.add(n)
          if (n.pair) {
            dirty.add(n.pair.fat)
            for (const st of n.pair.stubs) dirty.add(st)
          }
        }
      }
      if (!cfg.incremental) dirty = null
      // A net that stays in conflict while close to its length cap has no other way round: its
      // neighbours have to make room, so it gains priority and takes its direct route through them.
      for (const n of nets) {
        if (n.kind === "stub" || !n.active) continue
        const hit = dirty ? dirty.has(n) : false
        n.stuckRounds = hit ? (n.stuckRounds ?? 0) + 1 : 0
        if (
          n.stuckRounds > cfg.stuckRounds &&
          n.path &&
          pathLen(n.path) > capOf(n) - cfg.capMargin
        ) {
          n.lenWeight = Math.min(
            n.lenWeight * cfg.stuckBoost,
            cfg.overWeightMax,
          )
          n.stuckRounds = 0
        }
      }
      if (total < best) {
        best = total
        bestAt = it
      }
      if (
        total &&
        bad.length <= cfg.finishAt &&
        it - bestAt > cfg.finishAfter &&
        it - lastFinish > cfg.finishAfter &&
        dirty
      ) {
        lastFinish = it
        if (finish([...dirty].filter((n) => n.kind !== "stub"))) {
          dirty = new Set()
          best = 0
          bestAt = it
          continue
        }
      }
      if (it - bestAt > cfg.stallIters && total) {
        if (kicks >= cfg.maxKicks) {
          log(`  stalled at ${total} conflicts for ${cfg.stallIters} rounds`)
          return false
        }
        // Stalled: the nets in conflict have no other way, and their settled neighbours are never asked
        // to move. Rip up everything that passes near the conflicts and renegotiate that neighbourhood.
        kicks++
        const spots: Pt[] = []
        for (const n of dirty ?? []) {
          if (!n.path) continue
          withExemptions(n, () => {
            const occ = n.kind === "fat" ? occF : occT
            for (const id of n.path!) {
              const l = layerOf(id),
                c = id - l * NN
              if (occ[l][c]) spots.push(xy(c))
            }
          })
        }
        const R = cfg.kickRadius * (1 + cfg.kickGrowth * (kicks - 1)),
          near = (n: Net) =>
            !!n.path &&
            n.path.some(
              (id, k) =>
                k % 4 === 0 &&
                spots.some((q) => {
                  const p = xy(id)
                  return Math.abs(p.x - q.x) < R && Math.abs(p.y - q.y) < R
                }),
            )
        const before = dirty?.size ?? 0
        for (const n of nets)
          if (n.active && near(n)) {
            dirty!.add(n)
            if (n.pair) {
              dirty!.add(n.pair.fat)
              for (const st of n.pair.stubs) dirty!.add(st)
            }
          }
        log(
          `  stalled at ${total} conflicts: kick ${kicks}, ripping up ${dirty!.size} nets (was ${before}) within ${R.toFixed(1)} mm`,
        )
        presFac = cfg.presRestart
        best = Infinity
        bestAt = it
        continue
      }
      const ev =
        it % cfg.evalEvery === cfg.evalEvery - 1 || !total ? evaluate(!total) : null
      if (it % 5 === 4 || !total)
        log(
          `  iter ${it} [${((performance.now() - t0) / 1e3).toFixed(0)}s] pres=${presFac.toFixed(1)} conflicts=${total} nets=${bad.length} ${bad.slice(0, 8).join(",")} vias=${nets.reduce((s, n) => s + viaCount(n), 0)}` +
            (ev
              ? ` | ok=${ev.ok} over=${ev.over.map((v) => `${v.label}:${v.base!.toFixed(2)}>${v.top!.toFixed(2)}`).join(",")} ${ev.msgs.slice(0, 3).join("; ")}`
              : ""),
        )
      if (!total && ev?.ok) {
        if (phase >= phases.length - 1) return true
        // Soft staging: the next, less important group joins. The nets already placed stay where they
        // are but are not frozen: one that walls in a newcomer is ripped up like any net in conflict.
        phase++
        const add = new Set(phases[phase])
        let cnt = 0
        for (const n of nets) {
          const names = n.pair
            ? n.pair.conns.map((c: any) => c.name)
            : [n.conn.name]
          if (!n.active && names.some((x: string) => add.has(x))) {
            n.active = true
            dirty!.add(n)
            cnt++
          }
        }
        log(`  phase ${phase}: +${cnt} nets at iter ${it}`)
        presFac = cfg.presRestart
        best = Infinity
        bestAt = it
        kicks = 0
        continue
      }
      if (ev && dirty) {
        for (const n of ev.changed) dirty.add(n)
        if (!total)
          for (const n of ev.over) {
            dirty.add(n)
            if (n.pair) for (const st of n.pair.stubs) dirty.add(st)
          }
      }
      if (!total && ev && ev.untunable.length && dirty) {
        // Conflict-free, but a pair's members differ by more than a trim can absorb: its stubs take the
        // short way with rising priority and the nets in their way are renegotiated.
        for (const n of ev.untunable) {
          dirty.add(n)
          for (const st of n.pair!.stubs) {
            st.lenWeight = Math.min(
              st.lenWeight * cfg.stubBoost,
              cfg.overWeightMax,
            )
            dirty.add(st)
          }
        }
        presFac = Math.max(cfg.presRestart, presFac / 4)
      }
      if (!total && ev && ev.over.length) {
        // Conflict-free but a net is longer than its window allows: the others have settled on its
        // direct route. Reopen the negotiation with that net weighted up so it can take the route back.
        for (const n of ev.over)
          n.lenWeight = Math.min(n.lenWeight * cfg.overBoost, cfg.overWeightMax)
        presFac = cfg.presRestart
        continue
      }
      presFac = Math.min(presFac * cfg.presGrowth, cfg.presMax)
    }
    return false
  }

  // ---------- output ----------
  function emit(): any[] {
    const traces: any[] = []
    const wire = (p: Pt, l: number) => ({
      route_type: "wire",
      x: +p.x.toFixed(5),
      y: +p.y.toFixed(5),
      layer: LAYERS[l],
      width: cfg.w,
    })
    // a node that is a terminal's grid node is emitted at the terminal's exact centre, so a via-in-pad is centred
    const exactAt = new Map<number, Pt>()
    for (const c of origProblem.connections)
      for (const q of c.pointsToConnect)
        exactAt.set(nodeOf(q), { x: q.x, y: q.y })
    const fromIds = (ids: number[]): any[] => {
      const r: any[] = []
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k],
          l = layerOf(id),
          p = exactAt.get(id % NN) ?? xy(id)
        if (k && layerOf(ids[k - 1]) !== l)
          r.push({
            route_type: "via",
            x: +p.x.toFixed(5),
            y: +p.y.toFixed(5),
            from_layer: LAYERS[layerOf(ids[k - 1])],
            to_layer: LAYERS[l],
            via_diameter: cfg.viaD,
            via_hole_diameter: cfg.viaHole,
          })
        r.push(wire(p, l))
      }
      return r
    }
    // A V-notch: wire points A, B, C on one layer where A to C is at most about two grid steps
    // and B sits off that line. The grid search leaves one where a lane joins a path; it adds
    // nothing but a same-net sliver. Cut it while the net keeps `allowance` mm of length to give.
    const cutNotches = (route: any[], allowance: number) => {
      const r = [...route]
      let left = allowance
      for (let i = 1; i < r.length - 1; i++) {
        const a = r[i - 1],
          b = r[i],
          c = r[i + 1]
        if (
          [a, b, c].some((p) => p.route_type !== "wire" || p.layer !== b.layer)
        )
          continue
        const ac = Math.hypot(c.x - a.x, c.y - a.y),
          abc =
            Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y)
        if (ac <= 2.2 * P && abc > ac + 0.4 * P && abc - ac <= left) {
          r.splice(i, 1)
          left -= abc - ac
          i = Math.max(0, i - 2)
        }
      }
      return r
    }
    const tidy = (route: any[], notchAllowance = 0) => {
      const out: any[] = []
      for (const r of cutNotches(route, notchAllowance)) {
        const m = out.length
        if (
          r.route_type === "wire" &&
          m &&
          out[m - 1].route_type === "wire" &&
          out[m - 1].layer === r.layer &&
          Math.hypot(out[m - 1].x - r.x, out[m - 1].y - r.y) < 1e-7
        )
          continue
        if (
          r.route_type === "wire" &&
          m >= 2 &&
          out[m - 1].route_type === "wire" &&
          out[m - 2].route_type === "wire" &&
          out[m - 1].layer === r.layer &&
          out[m - 2].layer === r.layer
        ) {
          const cr =
              (out[m - 1].x - out[m - 2].x) * (r.y - out[m - 1].y) -
              (out[m - 1].y - out[m - 2].y) * (r.x - out[m - 1].x),
            dot =
              (out[m - 1].x - out[m - 2].x) * (r.x - out[m - 1].x) +
              (out[m - 1].y - out[m - 2].y) * (r.y - out[m - 1].y)
          if (Math.abs(cr) < 1e-9 && dot >= 0) {
            out[m - 1] = r
            continue
          }
        }
        out.push(r)
      }
      return out
    }
    const trace = (c: any, route: any[], notchAllowance = 0) =>
      traces.push({
        type: "pcb_trace",
        pcb_trace_id: `ddr_lane_${c.name}`,
        connection_name: c.name,
        source_trace_id: c.source_trace_id ?? c.name,
        route: tidy(route, notchAllowance),
      })
    // a single may give up length down to the bottom of its window; pair members keep theirs (pair skew)
    const allowanceOf = (n: Net) =>
      !cfg.cutNotches
        ? 0
        : n.lo === undefined
          ? Infinity
          : Math.max(0, n.target! - n.lo - 1e-6)
    for (const n of nets) {
      if (n.kind === "single") {
        const { a, b } = singleParts(n),
          pads = sortedPads(n.conn),
          u = xy(a.at(-1)!),
          v = xy(b[0]),
          l = n.laneLayer!
        trace(
          n.conn,
          [
            wire(pads[0], LOf(pads[0])),
            ...fromIds(a),
            ...singleLane(u.x, v.x, u.y, n.target! - n.base!)
              .slice(1)
              .map((q) => wire(q, l)),
            ...fromIds(b).slice(1),
            wire(pads[1], LOf(pads[1])),
          ],
          allowanceOf(n),
        )
      } else if (n.kind === "fat") {
        const pr = n.pair!,
          t = pairTune(n, n.target!),
          mem = pairMembers(n, t.ec, t.trims).pts
        for (const m of [0, 1]) {
          const pads = sortedPads(pr.conns[m]),
            j = joinMember(n, m, mem[m])
          trace(pr.conns[m], [
            wire(pads[0], LOf(pads[0])),
            ...fromIds(j.a),
            ...j.mem.map((q) => wire(q, n.fatLayer ?? 0)),
            ...fromIds([...j.b].reverse()),
            wire(pads[1], LOf(pads[1])),
          ])
        }
      }
    }
    return traces
  }

  // ---------- main ----------
  log(
    `grid ${NX}x${NY} @${P}mm, ${nets.filter((n) => n.kind === "single").length} single nets, ${pairs.length} pairs, lane ${laneLen.toFixed(2)}mm (${kSingle} bumps, ${kPair} pair bumps)`,
  )
  for (const pr of pairs)
    log(
      `  pair ${pr.fat.label}: leaves ${JSON.stringify(pr.d[0])} at (${pr.G[0].x.toFixed(2)},${pr.G[0].y.toFixed(2)}), arrives from ${JSON.stringify(pr.d[1])} at (${pr.G[1].x.toFixed(2)},${pr.G[1].y.toFixed(2)})`,
    )
  const success = negotiate()
  if (success) {
    log(`SOLVED in ${((performance.now() - t0) / 1e3).toFixed(0)}s`)
    return {
      solved: true,
      traces: emit(),
      stuck: [],
      log: logLines,
      iterations,
    }
  }
  // Report what is still in the way: nets in conflict or without a path, else the nets over their window.
  const namesOf = (n: Net): string[] =>
    n.pair ? n.pair.conns.map((c: any) => c.name) : [n.conn.name]
  const stuck = new Set<string>()
  for (const n of nets)
    if (n.active && (!n.path || conflictsOf(n, 0)))
      for (const name of namesOf(n)) stuck.add(name)
  if (!stuck.size)
    for (const n of evaluate().over)
      for (const name of namesOf(n)) stuck.add(name)
  for (const n of nets) {
    if (!n.active) continue
    if (!n.path) {
      log(`DIAG ${n.label}: no path`)
      continue
    }
    withExemptions(n, () => {
      const path = n.path!,
        occ = n.kind === "fat" ? occF : occT,
        tc: string[] = [],
        vc: string[] = []
      for (let k = 0; k < path.length; k++) {
        const id = path[k],
          l = layerOf(id),
          c = id - l * NN,
          q = xy(c)
        if (occ[l][c])
          tc.push(
            `${LAYERS[l][0]}(${q.x.toFixed(2)},${q.y.toFixed(2)})h${histT[l][c].toFixed(0)}`,
          )
        if (k && layerOf(path[k - 1]) !== l && occV[c])
          vc.push(
            `(${q.x.toFixed(2)},${q.y.toFixed(2)})h${histV[c].toFixed(0)}`,
          )
      }
      let lane = ""
      if (n.stamp?.lane) {
        const [l, a, b] = n.stamp.lane
        for (let j = Math.max(0, a); j <= Math.min(NY - 1, b); j++)
          if (occLane[l][j]) lane += ` ${LAYERS[l][0]}y${wy(j).toFixed(2)}`
      }
      if (tc.length || vc.length || lane)
        log(
          `DIAG ${n.label} fatLayer=${n.fatLayer} w=${n.lenWeight.toFixed(1)} len=${pathLen(path).toFixed(1)} cap=${capOf(n).toFixed(1)} trace[${tc.length}]: ${tc.slice(0, 4).join(" ")} .. ${tc.slice(-1).join(" ")} | via: ${vc.join(" ")} | lane:${lane.slice(0, 120)}`,
        )
    })
  }
  log(
    `FAILED after ${((performance.now() - t0) / 1e3).toFixed(0)}s, stuck: ${[...stuck].map(label).join(",")}`,
  )
  let partial: any[] = []
  try {
    for (const n of nets)
      if (n.kind !== "stub" && n.path && Number.isFinite(n.base ?? Infinity))
        n.target = n.base
    partial = emit()
  } catch {}
  return {
    solved: false,
    traces: [],
    partial,
    stuck: [...stuck],
    log: logLines,
    iterations,
  } as NegotiatedLaneResult
}
