import { mkdirSync, writeFileSync } from "node:fs"
import { routeCoupledPair } from "../lib/coupled-pair-routing"
import { runRotatedPairHandoffCase } from "./rotated-pair-handoff-case"
const result = runRotatedPairHandoffCase(routeCoupledPair),
  out = process.argv[2] ?? "docs/rotated-pair-handoff"
for (const { report, traces } of result.cases) {
  if (
    !report.solved ||
    !report.drc.valid ||
    !report.pairs.every((p) => p.matched) ||
    !report.coupling.every((p) => p.matched)
  )
    throw Error("Only complete validated routes may be exported")
  for (const c of result.input.connections) {
    const t = traces.find((t) => t.connection_name === c.name)!
    if (
      Math.hypot(
        t.route[0].x - c.pointsToConnect[0].x,
        t.route[0].y - c.pointsToConnect[0].y,
      ) > 1e-8 ||
      Math.hypot(
        t.route.at(-1)!.x - c.pointsToConnect[1].x,
        t.route.at(-1)!.y - c.pointsToConnect[1].y,
      ) > 1e-8
    )
      throw Error("Disconnected export")
  }
}
mkdirSync(out, { recursive: true })
result.cases.forEach(({ traces }, index) => {
  const points = [
      ...result.input.obstacles.map((o) => o.center),
      ...traces.flatMap((t) => t.route),
    ],
    minX = Math.min(...points.map((p) => p.x)) - 2,
    maxX = Math.max(...points.map((p) => p.x)) + 2,
    minY = Math.min(...points.map((p) => p.y)) - 3,
    maxY = Math.max(...points.map((p) => p.y)) + 3,
    parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900" viewBox="${minX} ${-maxY} ${maxX - minX} ${maxY - minY}"><rect x="${minX}" y="${-maxY}" width="${maxX - minX}" height="${maxY - minY}" fill="#fafafa"/><g transform="scale(1,-1)">`,
    ]
  for (const o of result.input.obstacles) {
    const a = ((o.ccwRotationDegrees ?? 0) * Math.PI) / 180,
      w = Math.abs(Math.cos(a)) * o.width + Math.abs(Math.sin(a)) * o.height,
      h = Math.abs(Math.sin(a)) * o.width + Math.abs(Math.cos(a)) * o.height
    parts.push(
      `<rect x="${o.center.x - w / 2}" y="${o.center.y - h / 2}" width="${w}" height="${h}" fill="#ddd" stroke="#666" stroke-width="0.02"/>`,
    )
  }
  traces.forEach((t, i) =>
    parts.push(
      `<polyline points="${t.route.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${i ? "#0866cc" : "#d32f2f"}" stroke-width="0.1"/>`,
    ),
  )
  parts.push(
    `</g><text x="${minX + 0.5}" y="${-maxY + 1}" font-size="0.5">Fresh native pair; ${index ? "equivalent axis-aligned" : "rotated"} pad representation</text></svg>`,
  )
  writeFileSync(
    `${out}/${index ? "axis-aligned" : "rotated"}.svg`,
    parts.join(""),
  )
})
