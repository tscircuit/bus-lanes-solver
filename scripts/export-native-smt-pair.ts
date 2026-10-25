import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import { runNativeSmtPairCase } from "./native-smt-pair-case"
const { BusLanesPipelineSolver } = await import(
  pathToFileURL(resolve(process.argv[2] ?? "lib/index.ts")).href
)
const { input, traces, report } = runNativeSmtPairCase(BusLanesPipelineSolver)
if (!report.accepted)
  throw Error("Refusing to export an incomplete or invalid route")
const all = [...(input.traces ?? []), ...traces]
const boxes = input.obstacles.map((o) => {
  const a = ((o.ccwRotationDegrees ?? 0) * Math.PI) / 180
  return {
    o,
    w: Math.abs(Math.cos(a)) * o.width + Math.abs(Math.sin(a)) * o.height,
    h: Math.abs(Math.sin(a)) * o.width + Math.abs(Math.cos(a)) * o.height,
  }
})
const minX =
    Math.min(
      ...boxes.map(({ o, w }) => o.center.x - w / 2),
      ...all.flatMap((t) => t.route.map((p) => p.x)),
    ) - 1,
  maxX =
    Math.max(
      ...boxes.map(({ o, w }) => o.center.x + w / 2),
      ...all.flatMap((t) => t.route.map((p) => p.x)),
    ) + 1,
  minY =
    Math.min(
      ...boxes.map(({ o, h }) => o.center.y - h / 2),
      ...all.flatMap((t) => t.route.map((p) => p.y)),
    ) - 1,
  maxY =
    Math.max(
      ...boxes.map(({ o, h }) => o.center.y + h / 2),
      ...all.flatMap((t) => t.route.map((p) => p.y)),
    ) + 2
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="850" viewBox="${minX} ${-maxY} ${maxX - minX} ${maxY - minY}"><rect x="${minX}" y="${-maxY}" width="${maxX - minX}" height="${maxY - minY}" fill="#fafafa"/><g transform="scale(1,-1)">`,
]
for (const { o, w, h } of boxes)
  parts.push(
    `<rect x="${o.center.x - w / 2}" y="${o.center.y - h / 2}" width="${w}" height="${h}" fill="#d4d9df" stroke="#69717b" stroke-width=".02"/>`,
  )
for (const t of all) {
  const color =
    t.connection_name === input.connections[0].name ? "#d13f3f" : "#226bc1"
  let run: any[] = []
  const draw = () => {
    if (run.length > 1)
      parts.push(
        `<polyline points="${run.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${run[0].width}"/>`,
      )
    run = []
  }
  for (const p of t.route) {
    if (p.route_type === "wire") run.push(p)
    else {
      draw()
      parts.push(
        `<circle cx="${p.x}" cy="${p.y}" r="${(p.via_diameter ?? 0.5) / 2}" fill="${color}"/><circle cx="${p.x}" cy="${p.y}" r="${(p.via_hole_diameter ?? 0.3) / 2}" fill="#fafafa"/>`,
      )
    }
  }
  draw()
}
parts.push(
  `</g><text x="${minX + 0.3}" y="${-maxY + 0.8}" font-family="sans-serif" font-size=".34">Native SMT pair: two complete signals; DRC, skew, coupling and terminal-via checks pass</text></svg>`,
)
mkdirSync("docs/native-smt-pair", { recursive: true })
writeFileSync("docs/native-smt-pair/routed.svg", parts.join(""))
console.log(JSON.stringify(report))
