import { readFileSync, writeFileSync } from "node:fs"
import type { SimpleRouteJson } from "../../lib/types"
import { loadInput } from "./input"

const esc = (s: string) =>
  s.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
  )
const colors = [
  "#55c1ff",
  "#b49bff",
  "#ffcc70",
  "#6ee0b4",
  "#f494be",
  "#92b9ff",
]
export function renderInputSnapshot(
  input: SimpleRouteJson,
  zoom = false,
): string {
  if (input.traces?.length)
    throw Error(
      "Input-only failure snapshot refuses supplied or candidate copper",
    )
  const baseline = JSON.parse(
    readFileSync(new URL("./baseline.json", import.meta.url), "utf8"),
  )
  if (
    Object.values(baseline.cases).some(
      (r: any) => r.status !== "solver_failed" || r.returnedTraces !== 0,
    )
  )
    throw Error(
      "Failure snapshot requires zero accepted routes; use a validated completed-output exporter after a fix",
    )
  const names = new Set(input.buses?.[0].connectionNames ?? [])
  const connections = zoom
    ? input.connections.filter((c) => names.has(c.name))
    : input.connections
  const focus = connections.flatMap((c) =>
    c.pointsToConnect.filter((p) => p.pcb_port_id?.startsWith("U1_")),
  )
  const pads = input.obstacles
  const box = zoom
    ? {
        minX: Math.min(...focus.map((p) => p.x)) - 0.8,
        maxX: Math.max(...focus.map((p) => p.x)) + 0.8,
        minY: Math.min(...focus.map((p) => p.y)) - 0.8,
        maxY: Math.max(...focus.map((p) => p.y)) + 0.8,
      }
    : {
        minX: Math.min(...pads.map((p) => p.center.x - p.width / 2)) - 1,
        maxX: Math.max(...pads.map((p) => p.center.x + p.width / 2)) + 1,
        minY: Math.min(...pads.map((p) => p.center.y - p.height / 2)) - 1,
        maxY: Math.max(...pads.map((p) => p.center.y + p.height / 2)) + 1,
      }
  const width = 640,
    height = 570,
    x = 28,
    y = 130
  const scale = Math.min(
    width / (box.maxX - box.minX),
    height / (box.maxY - box.minY),
  )
  const sx = (v: number) =>
    x + width / 2 + (v - (box.minX + box.maxX) / 2) * scale
  const sy = (v: number) =>
    y + height / 2 - (v - (box.minY + box.maxY) / 2) * scale
  const num = (v: number) => v.toFixed(3)
  const text = (
    a: number,
    b: number,
    s: string,
    size = 15,
    color = "#dbe7f5",
  ) =>
    `<text x="${a}" y="${b}" font-size="${size}" fill="${color}">${esc(s)}</text>`
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1180" height="780" viewBox="0 0 1180 780"><title>Handheld Gaming Console: unrouted input failure diagnostic</title><rect width="1180" height="780" fill="#0c1422"/><g font-family="Arial, sans-serif">`,
    text(28, 38, "Handheld Gaming Console", 26),
    text(
      28,
      68,
      zoom
        ? "CPU byte A0 escape request — INPUT ONLY"
        : "RK3562 + LPDDR4X — INPUT ONLY",
      18,
    ),
    text(
      28,
      99,
      "UNROUTED INPUT · 0 / 65 accepted routes · dashed lines are requests, not copper",
      16,
      "#ffbe78",
    ),
    `<defs><clipPath id="board"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath></defs><g clip-path="url(#board)"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#142238"/>`,
  ]
  for (const p of pads) {
    const selected = p.connectedTo.some((n) =>
      connections.some((c) => c.name === n),
    )
    const fill = selected ? "#f5ce85" : "#65748b"
    if (p.shape === "circle")
      parts.push(
        `<circle cx="${num(sx(p.center.x))}" cy="${num(sy(p.center.y))}" r="${num((p.width * scale) / 2)}" fill="${fill}"/>`,
      )
    else
      parts.push(
        `<rect x="${num(sx(p.center.x - p.width / 2))}" y="${num(sy(p.center.y + p.height / 2))}" width="${num(p.width * scale)}" height="${num(p.height * scale)}" fill="${fill}"/>`,
      )
  }
  for (const c of connections) {
    const a = c.pointsToConnect[0],
      b = c.pointsToConnect[1]
    const group =
      input.buses?.findIndex((g) => g.connectionNames.includes(c.name)) ?? -1
    const color = colors[(group + colors.length) % colors.length]
    parts.push(
      `<line data-airwire="${esc(c.name)}" x1="${num(sx(a.x))}" y1="${num(sy(a.y))}" x2="${num(sx(b.x))}" y2="${num(sy(b.y))}" stroke="${color}" stroke-width="${zoom ? 1.4 : 0.8}" stroke-opacity="${zoom ? 0.85 : 0.45}" stroke-dasharray="5 5"/>`,
    )
    if (zoom) {
      const p = c.pointsToConnect.find((p) => p.pcb_port_id?.startsWith("U1_"))!
      parts.push(text(sx(p.x) + 5, sy(p.y) - 5, c.name, 11, color))
    }
  }
  parts.push("</g>")
  const details = [
    "STOCK SOLVER v0.0.55",
    "Matched / five signal layers",
    "Native carrier matching exhausted",
    "its routing plans.",
    "",
    "Connectivity / one inner carrier",
    "300 passes; 1 conflict remains.",
    "65 candidates ≠ 65 accepted routes.",
    "",
    "Scope",
    "65 signals · 816 native pad obstacles",
    "6 bus groups · 6 differential pairs",
    "No saved routes or custom escapes",
    "",
    "Not shown",
    "Internal candidate copper is not exported",
    "by the stock solver after failure.",
    "This picture does not locate that conflict.",
    "",
    "Not timing, impedance or hardware approval.",
  ]
  details.forEach((s, i) =>
    parts.push(
      text(
        705,
        150 + i * 25,
        s,
        i === 0 ? 18 : 15,
        i === 0 ? "#ffbe78" : "#dbe7f5",
      ),
    ),
  )
  parts.push(
    text(
      28,
      733,
      zoom
        ? "Zoom retains original pad positions; clipped dashed lines continue toward RAM."
        : "Original placements retained. Power/reference copper and board outline are outside this fixture.",
      14,
    ),
    text(
      28,
      759,
      "Failure baseline: be9fc18 / v0.0.55 · snapshot regenerated from the immutable SRJ",
      13,
      "#91a6c2",
    ),
    "</g></svg>",
  )
  return parts.join("\n") + "\n"
}
if (import.meta.main) {
  const input = loadInput()
  for (const [name, zoom] of [
    ["board.snap.svg", false],
    ["cpu-escape.snap.svg", true],
  ] as const)
    writeFileSync(
      new URL(name, import.meta.url),
      renderInputSnapshot(input, zoom),
    )
}
