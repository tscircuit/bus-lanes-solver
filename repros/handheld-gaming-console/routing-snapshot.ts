import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { SingleLayerConnectivitySolver } from "../../lib/single-layer-connectivity-solver"
import { joinedSignalGeometryIsValid } from "../../lib/joined-signal-geometry"
import { busLengthReports } from "../../lib/route-lengths"
import type { SimpleRouteJson, Trace } from "../../lib/types"
import { loadInput } from "./input"

const dir = new URL("./", import.meta.url)
export const expectation = JSON.parse(
  readFileSync(new URL("routing-expectation.json", dir), "utf8"),
)

export function validateConnectivitySnapshot(
  input: SimpleRouteJson,
  traces: Trace[],
) {
  if (
    traces.length !== input.connections.length ||
    new Set(traces.map((t) => t.connection_name)).size !==
      input.connections.length
  )
    throw Error("Snapshot requires every requested signal exactly once")
  for (const c of input.connections) {
    const t = traces.find((t) => t.connection_name === c.name)
    if (!t) throw Error("Snapshot missing requested signal")
    for (const side of [0, 1]) {
      const p = side ? t.route.at(-1)! : t.route[0]
      const q = c.pointsToConnect[side]
      if (
        p.route_type !== "wire" ||
        p.layer !== q.layer ||
        Math.hypot(p.x - q.x, p.y - q.y) > 1e-8
      )
        throw Error("Snapshot endpoint mismatch")
    }
    if (!joinedSignalGeometryIsValid({ input, trace: t, smoothTuning: false }))
      throw Error("Snapshot self-clearance failed")
  }
  const vias = traces.flatMap((t) =>
    t.route.filter((p) => p.route_type === "via"),
  )
  for (let i = 0; i < vias.length; i++)
    for (let j = 0; j < i; j++) {
      const a = vias[i],
        b = vias[j],
        required =
          (input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0) +
          ((a.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15) +
            (b.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15)) /
            2
      if (Math.hypot(a.x - b.x, a.y - b.y) < required - 1e-8)
        throw Error("Snapshot drill clearance failed")
    }
  const drc = validateRoutedCopperDrc({
    inputSrj: input,
    routedSrj: { ...input, traces },
    clearance: input.minTraceToPadEdgeClearance ?? 0.09,
    allowBlindAndBuriedVias: false,
  } as never)
  if (!drc.valid) throw Error("Snapshot copper DRC failed")
}

export function renderRoutingSnapshot(
  input: SimpleRouteJson,
  traces: Trace[],
  solved: boolean,
) {
  if (solved) validateConnectivitySnapshot(input, traces)
  const color = solved ? "#66dfb6" : "#ff7e87"
  const esc = (s: string) =>
    s.replace(
      /[<>&"]/g,
      (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
    )
  const text = (x: number, y: number, s: string, size = 17, c = "#e0e8f4") =>
    `<text x="${x}" y="${y}" fill="${c}" font-size="${size}">${esc(s)}</text>`
  const box = { minX: -10, maxX: 10, minY: -10, maxY: 21 }
  const sx = (x: number) => 30 + (x - box.minX) * 21,
    sy = (y: number) => 110 + (box.maxY - y) * 21
  const n = (v: number) => v.toFixed(4)
  const colors: Record<string, string> = {
    top: "#f5af53",
    inner3: "#56c9b2",
    bottom: "#b593f6",
  }
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="830" viewBox="0 0 1120 830"><rect width="1120" height="830" fill="#101a29"/><g font-family="Arial,sans-serif">`,
    text(
      28,
      38,
      "Handheld Gaming Console — same six-layer routing fixture",
      25,
    ),
    text(
      28,
      72,
      solved
        ? "PASS: 65 / 65 connected — geometry checks passed"
        : "FAIL: routing exhausted — 0 / 65 accepted routes",
      22,
      color,
    ),
    '<rect x="25" y="105" width="430" height="660" fill="#19283c"/>',
  ]
  for (const p of input.obstacles) {
    if (!p.layers.includes("top")) continue
    if (p.shape === "circle")
      parts.push(
        `<circle cx="${n(sx(p.center.x))}" cy="${n(sy(p.center.y))}" r="${n((p.width * 21) / 2)}" fill="#6c8097"/>`,
      )
    else
      parts.push(
        `<rect x="${n(sx(p.center.x - p.width / 2))}" y="${n(sy(p.center.y + p.height / 2))}" width="${n(p.width * 21)}" height="${n(p.height * 21)}" fill="#6c8097"/>`,
      )
  }
  for (const t of traces)
    for (let i = 0; i < t.route.length; i++) {
      const a = t.route[i],
        b = t.route[i + 1]
      if (a.route_type === "via")
        parts.push(
          `<circle cx="${n(sx(a.x))}" cy="${n(sy(a.y))}" r="${n(((a.via_diameter ?? 0.25) * 21) / 2)}" fill="#eee0a9"/><circle cx="${n(sx(a.x))}" cy="${n(sy(a.y))}" r="${n(((a.via_hole_diameter ?? 0.15) * 21) / 2)}" fill="#19283c"/>`,
        )
      if (
        b &&
        a.route_type === "wire" &&
        b.route_type === "wire" &&
        a.layer === b.layer &&
        Math.hypot(a.x - b.x, a.y - b.y) > 1e-7
      )
        parts.push(
          `<path d="M ${n(sx(a.x))} ${n(sy(a.y))} L ${n(sx(b.x))} ${n(sy(b.y))}" stroke="${colors[a.layer] ?? "#fff"}" stroke-width="${n(a.width * 21)}" fill="none"/>`,
        )
    }
  if (!solved)
    parts.push(
      `<circle cx="${n(sx(-4.6))}" cy="${n(sy(6.4))}" r="20" fill="none" stroke="#ff506d" stroke-width="3"/>`,
    )
  const labels = solved
    ? [
        "Fresh solve with general connectivity fix",
        "65 requested signals / 65 accepted",
        "No saved routes supplied to solver",
        "Copper clearance: PASS",
        "Drill spacing: PASS",
        "Endpoints and self-clearance: PASS",
        "Original pads, placements and widths preserved",
        "Length matching: still failing",
        "Differential coupling: not approved",
      ]
    : [
        "Fresh stock-solver failure",
        "300 negotiation passes / 1 conflict remains",
        "Shown: recorded UNACCEPTED candidates",
        "Candidate paths are not completed routing",
        "Red circle: DQ5_A / DQ13_A crossing",
        "No routing hacks in the clean repro",
        "65 requested signals / 0 accepted",
        "Length matching: not achieved",
        "Differential coupling: not approved",
      ]
  labels.forEach((s, i) =>
    parts.push(text(490, 150 + i * 48, s, 18, i === 0 ? color : "#e0e8f4")),
  )
  parts.push(
    text(490, 650, "Orange: top · Green: L4 signal", 17),
    text(490, 690, "Other copper layers reserved or unused.", 17),
    text(
      28,
      797,
      "Connectivity-only regression. Not DDR timing, impedance or manufacturing approval.",
      17,
      "#ffcb75",
    ),
    "</g></svg>\n",
  )
  return parts.join("")
}

export function freshRoutingSnapshot() {
  const input = loadInput()
  input.allowedLayers = ["inner3"]
  const before = JSON.stringify(input)
  const solver = new SingleLayerConnectivitySolver(input, {
    gridStep: 0.1,
    maxPasses: 300,
    maxExpansionsPerRoute: 300000,
  })
  const start = performance.now()
  while (!solver.solved && !solver.failed && performance.now() - start < 600000)
    solver.step()
  if (JSON.stringify(input) !== before)
    throw Error("Snapshot solve mutated its fixture")
  if (
    solver.solved !== expectation.solved ||
    (!solver.solved && !solver.failed)
  )
    throw Error(
      "Fresh routing result does not match this revision's expectation",
    )
  let traces = solver.traces
  if (!solver.solved) {
    if (
      solver.stats.conflicts !== 1 ||
      solver.stats.pass !== 299 ||
      solver.traces.length
    )
      throw Error("Stock failure changed; recapture its diagnostic evidence")
    const raw = gunzipSync(
      readFileSync(
        new URL(
          "../../tests/fixtures/handheld-gaming-console/failed-candidates.json.gz",
          dir,
        ),
      ),
    )
    if (
      createHash("sha256").update(raw).digest("hex") !==
      expectation.candidateSha256
    )
      throw Error("Failure capture hash mismatch")
    traces = JSON.parse(raw.toString())
    const drc = validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces },
      clearance: 0.09,
      allowBlindAndBuriedVias: false,
    } as never)
    if (drc.valid)
      throw Error("Failure capture no longer demonstrates a copper conflict")
  }
  const svg = renderRoutingSnapshot(input, traces, solver.solved)
  return {
    svg,
    report: {
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      stats: solver.stats,
      acceptedRoutes: solver.traces.length,
      displayedCandidates: solver.solved ? 0 : traces.length,
      fixtureSha256: expectation.fixtureSha256,
      busReports: busLengthReports(input, solver.traces),
      elapsedMs: performance.now() - start,
      scope: "connectivity-only; DDR matching remains unapproved",
    },
  }
}
if (import.meta.main) {
  const result = freshRoutingSnapshot()
  writeFileSync(new URL("board.snap.svg", dir), result.svg)
  writeFileSync(
    new URL("results/routing-snapshot.json", dir),
    JSON.stringify(result.report, null, 2) + "\n",
  )
  console.log({
    solved: result.report.solved,
    acceptedRoutes: result.report.acceptedRoutes,
  })
}
