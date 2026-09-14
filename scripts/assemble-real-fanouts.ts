import { mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
await mkdir("examples/fanout-solver-outputs", { recursive: true })
for (const profile of process.argv.slice(2)) {
  const records = await Promise.all(
    ["soc", "ram"].map((side) =>
      Bun.file(`examples/fanout-solver-outputs/${profile}-${side}.json`).json(),
    ),
  )
  const input = structuredClone(records[0].input)
  input.traces = []
  const meta: any = {
    profile,
    kind: "coordinated-fanouts",
    marginMm: 6,
    fanoutGenerator: "@tscircuit/fanout-solver@0.0.78",
    provenance: {},
    allowViaInPad: records.every((r) => r.input.allowViaInPad === true),
  }
  for (const [index, side] of ["soc", "ram"].entries()) {
    const record = records[index],
      output = record.output
    if (!output.validation.valid || output.fanoutTraces.length !== 33)
      throw Error("Incomplete fanout output")
    const b = record.options.sharedBoundary
    meta[side + "Region"] = {
      minX: b.minX - 0.12,
      maxX: b.maxX + 0.12,
      minY: b.minY - 0.12,
      maxY: b.maxY + 0.12,
    }
    meta[side + "Center"] = {
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
    }
    const file = `examples/fanout-solver-outputs/${profile}-${side}.json`
    await Bun.write(file, JSON.stringify(record))
    meta.provenance[side] = {
      file,
      sha256: hash(record),
      inputSha256: hash(record.input),
      optionsSha256: hash(record.options),
      tracesSha256: hash(output.fanoutTraces),
      validation: output.validation,
    }
    input.traces.push(
      ...output.fanoutTraces.map((t: any) => ({
        ...t,
        source_trace_id: t.connection_name,
        pcb_trace_id: `${side}_fanout_${t.pcb_trace_id}`,
      })),
    )
  }
  input.connections = input.connections.map((c: any) => ({
    ...c,
    pointsToConnect: records.map((r, index) => {
      const t = r.output.fanoutTraces.find(
          (t: any) => t.connection_name === c.name,
        ),
        p = t.route.at(-1)
      return {
        x: p.x,
        y: p.y,
        layer: p.layer,
        pointId: `${index ? "ram" : "soc"}_exit_${c.name}`,
      }
    }),
  }))
  // Restore logical DDR groups for the downstream phase, after physical escape groups.
  const logicalBuses = await Bun.file("examples/ddr-buses.json").json()
  input.buses = logicalBuses.map((b: any) => ({
    ...b,
    allowedLayers: ["top", "inner2", "inner4", "inner6", "bottom"],
    preferredLayers: undefined,
  }))
  input.bounds = {
    minX: Math.min(meta.socRegion.minX, meta.ramRegion.minX) - 6,
    maxX: Math.max(meta.socRegion.maxX, meta.ramRegion.maxX) + 6,
    minY: Math.min(meta.socRegion.minY, meta.ramRegion.minY) - 6,
    maxY: Math.max(meta.socRegion.maxY, meta.ramRegion.maxY) + 6,
  }
  await Bun.write(`examples/data/${profile}.json`, JSON.stringify(input))
  await Bun.write(
    `examples/data/${profile}.meta.json`,
    JSON.stringify(meta, null, 2),
  )
  console.log(
    profile,
    input.connections.filter(
      (c: any) => c.pointsToConnect[0].layer !== c.pointsToConnect[1].layer,
    ).length,
    "mixed-layer endpoints",
  )
}
