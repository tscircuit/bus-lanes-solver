import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { mkdir } from "node:fs/promises"
import { Resvg } from "@resvg/resvg-js"
import { BusLanesPipelineSolver, busLengthReports } from "../lib"
import { meanderReturnGapInput } from "../tests/fixtures/meander-return-gap"
import { measureReturnGap } from "../tests/fixtures/measure-return-gap"

const mode = process.argv[2] ?? "default"
if (!["default", "wide", "paired"].includes(mode))
  throw Error("Expected default, wide, or paired")
const requestedGap = mode === "default" ? 0.2 : 0.5
const input = {
  ...(await meanderReturnGapInput({ paired: mode === "paired" })),
  minMeanderGap: requestedGap,
}
const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
solver.solve()
if (!solver.solved) throw Error(solver.error ?? "Routing did not complete")
const traces = solver.getOutput().traces!
const lengths = busLengthReports(input, traces)
if (!lengths.every((r) => r.matched)) throw Error("Bus is not matched")
const drc = validateRoutedCopperDrc({
  inputSrj: input,
  routedSrj: solver.getOutput(),
  clearance: 0.1,
} as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
if (!drc.valid) throw Error("Copper DRC failed")
const gap = measureReturnGap(traces)
if (gap.edgeGap < requestedGap - 1e-8) throw Error("Return-leg gap failed")
const f = (n: number) => n.toFixed(3)
const paths = traces
  .map(
    (t, i) =>
      `<polyline points="${t.route.map((p) => `${p.x},${-p.y}`).join(" ")}" fill="none" stroke="${i ? "#bcce8b" : "#57d8ee"}" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round"/>`,
  )
  .join("")
const pads = input.obstacles
  .map(
    (p) =>
      `<rect x="${p.center.x - p.width / 2}" y="${-p.center.y - p.height / 2}" width="${p.width}" height="${p.height}" fill="#e6bb75"/>`,
  )
  .join("")
const cx = (gap.a.x + gap.b.x) / 2,
  cy = (gap.a.y + gap.b.y) / 2
const dx = (gap.b.x - gap.a.x) / gap.centerline,
  dy = (gap.b.y - gap.a.y) / gap.centerline
const a = {
  x: gap.a.x + (dx * gap.a.width) / 2,
  y: gap.a.y + (dy * gap.a.width) / 2,
}
const b = {
  x: gap.b.x - (dx * gap.b.width) / 2,
  y: gap.b.y - (dy * gap.b.width) / 2,
}
const tick = (p: typeof a) =>
  `<path d="M ${p.x - dy * 0.1} ${-p.y - dx * 0.1} L ${p.x + dy * 0.1} ${-p.y + dx * 0.1}"/>`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="740" viewBox="0 0 1200 740">
<rect width="1200" height="740" fill="#101a26"/>
<g fill="#e8eef5" font-family="sans-serif">
<text x="40" y="48" font-size="28">${mode === "default" ? "Corrected default" : mode === "wide" ? "Requested wider gap" : "Shared pair with wider return gap"}: smooth meanders</text>
<text x="40" y="82" font-size="17">Real TSX → core SRJ conversion → BusLanesPipelineSolver · top copper · all dimensions in mm</text>
<text x="40" y="130" font-size="20">Complete routed board · ${traces.length} / ${traces.length} signals</text>
<text x="680" y="130" font-size="20">Measured returning straight legs</text>
</g>
<svg x="30" y="150" width="620" height="460" viewBox="-14 -11 28 22">
<rect x="-13" y="-10" width="26" height="20" rx="0.3" fill="#18293b" stroke="#456077" stroke-width="0.06"/>
${paths}${pads}<rect x="${cx - 1.2}" y="${-cy - 1.2}" width="2.4" height="2.4" fill="none" stroke="#ffad70" stroke-width="0.06" stroke-dasharray="0.15 0.1"/>
</svg>
<svg x="680" y="150" width="470" height="460" viewBox="${cx - 1.2} ${-cy - 1.2} 2.4 2.4">
<rect x="${cx - 1.2}" y="${-cy - 1.2}" width="2.4" height="2.4" fill="#18293b"/>
${paths}${pads}<g stroke="#ffad70" stroke-width="0.012"><path d="M ${a.x} ${-a.y} L ${b.x} ${-b.y}"/>${tick(a)}${tick(b)}</g>
</svg>
<g fill="#e8eef5" font-family="sans-serif" font-size="19">
<text x="40" y="650">Trace width: 0.100 · bus skew: ${f(lengths[0].skewMm!)}</text>
<text x="40" y="687">Required minimum: ${f(requestedGap)} edge / ${f(requestedGap + 0.1)} centerline</text>
<text x="680" y="650" fill="#ffad70">Edge gap: ${f(gap.edgeGap)}</text>
<text x="680" y="687">Centerline spacing: ${f(gap.centerline)}</text>
</g></svg>`
const directory = "docs/meander-return-gap"
await mkdir(directory, { recursive: true })
await Bun.write(`${directory}/${mode}.png`, new Resvg(svg).render().asPng())
await Bun.write(
  `${directory}/${mode}.json`,
  JSON.stringify({ requestedGap, gap, lengths, drcValid: drc.valid }, null, 2) +
    "\n",
)
console.log({ edgeGap: gap.edgeGap, centerline: gap.centerline, lengths })
