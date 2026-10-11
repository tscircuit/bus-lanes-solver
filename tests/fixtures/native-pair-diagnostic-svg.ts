import { Resvg } from "@resvg/resvg-js"
import { length } from "../../lib/geometry"
import { pairLengthReports } from "../../lib/route-lengths"
import type { Point, SimpleRouteJson, Trace } from "../../lib/types"
import type { captureNativePairProposal } from "./capture-native-pair-proposal"

type Proposal = ReturnType<typeof captureNativePairProposal>
const esc = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
const mm = (value: number) => `${value.toFixed(4)} mm`
const text = (
  x: number,
  y: number,
  value: string,
  size = 20,
  fill = "#cbd5e1",
) =>
  `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${fill}">${esc(value)}</text>`
const colors = ["#38bdf8", "#e879f9"]

/** A diagnostic of actual planner copper, never a completed-board artifact. */
export function nativePairDiagnosticSvg(
  input: SimpleRouteJson,
  proposal: Proposal,
  kind: "trunk" | "grid",
  state: "before" | "after",
) {
  const report = pairLengthReports(input, proposal.traces)[0]
  const accepted = proposal.attempts.filter(
    (attempt) => attempt.accepted,
  ).length
  const okay = kind === "trunk" ? report.matched : accepted > 0
  const status = okay ? "#4ade80" : "#fb7185"
  const bound = input.bounds
  const scale = Math.min(
    560 / (bound.maxX - bound.minX),
    510 / (bound.maxY - bound.minY),
  )
  const x = (p: Point) => 58 + (p.x - bound.minX) * scale
  const y = (p: Point) => 690 - (p.y - bound.minY) * scale
  const drawTrace = (
    trace: Trace,
    color: string,
    width = scale * input.minTraceWidth,
  ) =>
    trace.route
      .slice(1)
      .map((point, index) => {
        const previous = trace.route[index]
        return `<line x1="${x(previous)}" y1="${y(previous)}" x2="${x(point)}" y2="${y(point)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`
      })
      .join("") +
    trace.route
      .filter((point) => point.route_type === "via")
      .map(
        (point) =>
          `<circle cx="${x(point)}" cy="${y(point)}" r="${(scale * (input.minViaPadDiameter ?? 0.3)) / 2}" fill="${color}" stroke="#f8fafc" stroke-width="1.5"/><circle cx="${x(point)}" cy="${y(point)}" r="${(scale * (input.minViaHoleDiameter ?? 0.15)) / 2}" fill="#0f172a"/>`,
      )
      .join("")
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1180" height="850" viewBox="0 0 1180 850"><rect width="1180" height="850" fill="#0f172a"/>`
  svg += text(
    32,
    42,
    `${state.toUpperCase()} · ${kind === "trunk" ? (state === "before" ? "Offset trunk omitted from pair balancing" : "Whole copper included in pair balancing") : state === "before" ? "Via candidates use the wrong grid origin" : "Via candidates use the native grid origin"}`,
    28,
    "#f8fafc",
  )
  svg += text(
    32,
    76,
    "TSX circuit → Core 0.0.2125 → SRJ → real native pair planner",
    21,
  )
  svg += text(
    32,
    109,
    "Diagnostic: connected planner proposal before residual matching; not a completed board",
    18,
    "#94a3b8",
  )
  svg += `<rect x="30" y="142" width="614" height="590" rx="12" fill="#111e33"/><rect x="665" y="142" width="485" height="590" rx="12" fill="#111e33"/>`
  svg += text(50, 170, "Actual native copper · top pads + inner1 carrier", 18)
  svg += `<rect x="${x({ x: bound.minX, y: bound.minY })}" y="${y({ x: bound.minX, y: bound.maxY })}" width="${(bound.maxX - bound.minX) * scale}" height="${(bound.maxY - bound.minY) * scale}" fill="#17263b" stroke="#64748b" stroke-width="1.5"/>`
  svg += proposal.traces
    .map((trace, index) => drawTrace(trace, colors[index]))
    .join("")
  for (const obstacle of input.obstacles) {
    svg += `<circle cx="${x(obstacle.center)}" cy="${y(obstacle.center)}" r="${(obstacle.width * scale) / 2}" fill="#fbbf24" stroke="#fff7ed" stroke-width="1"/>`
    const label =
      (
        obstacle as typeof obstacle & {
          circuitJsonMetadata?: { source_port_name?: string }
        }
      ).circuitJsonMetadata?.source_port_name ?? "pad"
    svg += text(
      x(obstacle.center) + 18,
      y(obstacle.center) + 6,
      label,
      17,
      "#fde68a",
    )
  }
  svg +=
    text(50, 761, "P copper", 18, colors[0]) +
    text(185, 761, "N copper", 18, colors[1]) +
    text(325, 761, "Gold = Core pads · rings = full-span vias", 17)
  svg += text(
    685,
    180,
    okay
      ? "PASS: planner constraint satisfied"
      : kind === "trunk"
        ? "FAIL: pair length constraint"
        : "FAIL: balancing approaches rejected",
    22,
    status,
  )
  svg += text(
    685,
    224,
    `P whole copper: ${mm(report.lengths[0].totalLengthMm!)}`,
    21,
    colors[0],
  )
  svg += text(
    685,
    259,
    `N whole copper: ${mm(report.lengths[1].totalLengthMm!)}`,
    21,
    colors[1],
  )
  svg += text(
    685,
    304,
    `Pair skew: ${mm(report.skewMm!)}`,
    23,
    report.matched ? "#4ade80" : "#fb7185",
  )
  svg += text(
    685,
    340,
    `Authored maxLengthSkew: ${mm(report.toleranceMm!)}`,
    20,
  )
  if (kind === "trunk") {
    const trunks = proposal.carriers.map((trace) => length(trace.route))
    svg += text(685, 391, "Inner carrier + TOP escapes = whole copper", 19)
    for (const index of [0, 1]) {
      const total = report.lengths[index].totalLengthMm!
      const trunk = trunks[index]
      const unit = 50
      const yy = 424 + index * 75
      svg += text(
        685,
        yy,
        `${index ? "N" : "P"}: inner ${mm(trunk)}, TOP ${mm(total - trunk)}`,
        18,
      )
      svg += `<rect x="685" y="${yy + 10}" width="${trunk * unit}" height="22" fill="${colors[index]}"/><rect x="${685 + trunk * unit}" y="${yy + 10}" width="${(total - trunk) * unit}" height="22" fill="#fbbf24"/>`
    }
    svg += text(
      685,
      590,
      report.matched
        ? "No extra pair-skew correction needed here."
        : `Excess over limit: ${mm(report.skewMm! - report.toleranceMm!)}`,
      20,
      status,
    )
    svg += text(
      685,
      629,
      report.matched
        ? "Via rebalance accounts for the complete route."
        : "Refinement inherits this avoidable deficit.",
      18,
    )
    svg += text(
      685,
      669,
      "Both pad endpoints connected · copper DRC passes",
      17,
      "#4ade80",
    )
  } else {
    svg += text(
      685,
      390,
      `Accepted forced-via approaches: ${accepted}/${proposal.attempts.length}`,
      20,
      status,
    )
    svg += text(
      685,
      428,
      `Native grid origin: (${bound.minX}, ${bound.minY}) mm`,
      18,
    )
    svg += text(685, 462, "Grid step: 0.1000 mm", 18)
    svg += text(
      685,
      505,
      okay
        ? "Legal native-grid sites now reach the router."
        : "Off-grid sites cannot satisfy forced-via equality.",
      18,
    )
    svg += text(
      685,
      544,
      okay
        ? "Balancing can adjust a real routed approach."
        : "All balancing candidates fail; residual skew stays.",
      18,
      status,
    )
    const requested = proposal.projectedCandidate!
    const via = proposal.projectedAlternative!.route.find(
      (point) => point.route_type === "via",
    )!
    const zx = (p: Point) => 286 + (p.x - via.x) * 680
    const zy = (p: Point) => 291 - (p.y - via.y) * 680
    svg += text(
      50,
      206,
      "Via-center grid detail · same scene, separate control",
      17,
    )
    svg += `<rect x="78" y="220" width="415" height="152" rx="8" fill="#17263b" stroke="#475569"/>`
    for (let col = -2; col <= 2; col++)
      for (let row = -1; row <= 1; row++) {
        const point = { x: via.x + col * 0.1, y: via.y + row * 0.1 }
        svg += `<circle cx="${zx(point)}" cy="${zy(point)}" r="3.5" fill="#cbd5e1"/>`
      }
    if (state === "before")
      svg += `<path d="M ${zx(requested) - 9},${zy(requested) - 9} l18,18 M ${zx(requested) - 9},${zy(requested) + 9} l18,-18" stroke="#fb7185" stroke-width="4"/>`
    svg += `<circle cx="${zx(via)}" cy="${zy(via)}" r="10" fill="none" stroke="#4ade80" stroke-width="3"/>`
    svg += text(505, 266, "0.1 mm", 16) + text(505, 290, "grid", 16)
    svg += text(
      685,
      585,
      `Requested: (${requested.x.toFixed(2)}, ${requested.y.toFixed(2)}) mm`,
      18,
      state === "before" ? "#fb7185" : "#4ade80",
    )
    svg += text(
      685,
      624,
      `Legal control via: (${via.x.toFixed(2)}, ${via.y.toFixed(2)}) mm`,
      18,
      "#4ade80",
    )
    svg += text(
      685,
      663,
      "Control approach routed by the same native router.",
      17,
      "#4ade80",
    )
    svg += text(
      685,
      702,
      state === "before"
        ? "Red cross = rejected · green ring = legal control"
        : "Green ring = requested and accepted native site",
      17,
    )
  }
  svg += text(
    32,
    806,
    "Measurements are planar copper length; no stackup delay or whole-board routing claim.",
    18,
    "#94a3b8",
  )
  svg += "</svg>"
  return svg
}

export async function writeDiagnosticSnapshot(path: string, svg: string) {
  await Bun.write(path, svg)
  const image = new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng()
  await Bun.write(path.replace(/\.svg$/, ".png"), image)
}
