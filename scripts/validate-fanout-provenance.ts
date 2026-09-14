import { createHash } from "node:crypto"
import type { Trace } from "../lib"
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex")
/** Compare physical copper in board-world mm, ignoring port annotations and traversal direction. */
export function copperGeometry(t: Trace) {
  const round = (v: number) => Math.round(v * 1e9) / 1e9
  const p = t.route.map((p) =>
    p.route_type === "wire"
      ? [p.route_type, round(p.x), round(p.y), p.width, p.layer]
      : [
          p.route_type,
          round(p.x),
          round(p.y),
          p.via_diameter,
          ...[p.from_layer, p.to_layer].sort(),
        ],
  )
  return [JSON.stringify(p), JSON.stringify([...p].reverse())].sort()[0]
}
export async function validateFanoutProvenance(meta: any) {
  if (meta.fanoutGenerator !== "@tscircuit/fanout-solver@0.0.78")
    throw Error("Missing real FanoutSolver provenance")
  for (const side of ["soc", "ram"]) {
    const ref = meta.provenance[side],
      record = await Bun.file(ref.file).json()
    if (
      hash(record) !== ref.sha256 ||
      hash(record.input) !== ref.inputSha256 ||
      hash(record.options) !== ref.optionsSha256 ||
      hash(record.output.fanoutTraces) !== ref.tracesSha256
    )
      throw Error("FanoutSolver record hash mismatch")
    if (
      !record.output.validation.valid ||
      record.output.fanoutTraces.length !== 33
    )
      throw Error("Incomplete FanoutSolver output")
    const actual = meta.fixedFanoutTraces.filter((t: any) => t.side === side)
    if (actual.length !== 33) throw Error("Missing fixed fanout paths")
    for (const t of actual) {
      const name = meta.signalNames[t.source_trace_id]
      const original = record.output.fanoutTraces.find(
        (o: any) => o.connection_name === name,
      )
      if (!original || copperGeometry(original) !== copperGeometry(t))
        throw Error(
          `Fixed copper differs from real solver output: ${side} ${name}`,
        )
      for (let i = 1; i < t.route.length; i++) {
        const a = t.route[i - 1],
          b = t.route[i]
        if (a.route_type === "wire" && b.route_type === "wire") {
          if (a.layer !== b.layer) throw Error("Layer jump without a via")
        } else if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-7)
          throw Error("Gap at a via")
      }
    }
  }
  return { generator: meta.fanoutGenerator, verifiedPaths: 66 }
}
