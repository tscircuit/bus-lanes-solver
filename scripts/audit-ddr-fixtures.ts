import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { segmentDistance } from "../lib/geometry"
const moduleDir = process.argv[2]
if (!moduleDir) throw Error("Pass AM62L module directory")
const bounds = (points: any[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
})
const inside = (p: any, b: any) =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
const reports = []
for (const profile of [
  "ddr_left_io_right",
  "ddr_right_io_left",
  "ddr_top_io_bottom",
  "ddr_bottom_io_top",
]) {
  const json = await Bun.file(
    `${moduleDir}/dist/${profile}/circuit.json`,
  ).json()
  const raw = await Bun.file(`tests/fixtures/${profile}-raw.json`).json()
  const map = getFullConnectivityMapFromCircuitJson(json)
  const soc = json.find(
    (x: any) =>
      x.type === "pcb_component" &&
      x.source_component_id ===
        json.find((s: any) => s.type === "source_component" && s.name === "U1")
          .source_component_id,
  )
  const ram = json.find(
    (x: any) =>
      x.type === "pcb_component" &&
      x.source_component_id ===
        json.find((s: any) => s.type === "source_component" && s.name === "RAM")
          .source_component_id,
  )
  const nets = new Set(
    raw.connections.map((c: any) =>
      map.getNetConnectedToId(c.source_trace_id ?? c.name),
    ),
  )
  const saved = json.filter(
    (t: any) =>
      t.type === "pcb_trace" &&
      t.pcb_trace_id.startsWith("saved_fanout") &&
      nets.has(map.getNetConnectedToId(t.source_trace_id)),
  )
  const socBounds = bounds(saved.flatMap((t: any) => t.route))
  const corridors = [] as any[],
    tails = [] as any[]
  for (const c of raw.connections) {
    const t = json.find(
      (t: any) =>
        t.type === "pcb_trace" &&
        t.source_trace_id === (c.source_trace_id ?? c.name) &&
        !t.pcb_trace_id.startsWith("saved_fanout"),
    )
    if (!t) throw Error(c.name)
    const i = t.route.findIndex((p: any) => p.route_type === "via")
    const p = t.route[i]
    const source = c.pointsToConnect.find((p: any) => !p.pcb_port_id),
      pad = c.pointsToConnect.find((p: any) => p.pcb_port_id)
    tails.push({ ...t, route: t.route.slice(i) })
    corridors.push({
      name: c.name,
      source,
      selectedVia: { x: p.x, y: p.y },
      ramPad: pad,
      gapMm: Math.hypot(source.x - p.x, source.y - p.y),
      viaToRamPadMm: Math.hypot(pad.x - p.x, pad.y - p.y),
      viaInsideSocFanoutBounds: inside(p, socBounds),
    })
  }
  const tailBounds = bounds(tails.flatMap((t: any) => t.route))
  const layers = Array.from({ length: raw.layerCount }, (_, i) =>
    i === 0 ? "top" : i === raw.layerCount - 1 ? "bottom" : `inner${i}`,
  )
  const segments = (traces: any[]) =>
    traces.flatMap((t) =>
      t.route.flatMap((p: any, i: number) => {
        const q = t.route[i + 1],
          net = map.getNetConnectedToId(t.source_trace_id)
        if (p.route_type === "via") {
          const physical = json.find(
            (v: any) =>
              v.type === "pcb_via" &&
              v.pcb_trace_id === t.pcb_trace_id &&
              Math.hypot(v.x - p.x, v.y - p.y) < 1e-6,
          )
          const a = layers.indexOf(p.from_layer),
            b = layers.indexOf(p.to_layer)
          return (
            physical?.layers ??
            p.layers ??
            layers.slice(Math.min(a, b), Math.max(a, b) + 1)
          ).map((layer: string) => ({
            a: p,
            b: p,
            r: (p.via_diameter ?? 0.3) / 2,
            layer,
            net,
            id: t.pcb_trace_id,
          }))
        }
        return p.route_type === "wire" &&
          q?.route_type === "wire" &&
          q.layer === p.layer
          ? [
              {
                a: p,
                b: q,
                r: p.width / 2,
                layer: p.layer,
                net,
                id: t.pcb_trace_id,
              },
            ]
          : []
      }),
    )
  const contacts = [] as any[]
  for (const a of segments(saved))
    for (const b of segments(tails)) {
      if (a.layer !== b.layer || a.net === b.net) continue
      const r = a.r + b.r
      if (
        Math.max(a.a.x, a.b.x) + r < Math.min(b.a.x, b.b.x) ||
        Math.max(b.a.x, b.b.x) + r < Math.min(a.a.x, a.b.x) ||
        Math.max(a.a.y, a.b.y) + r < Math.min(b.a.y, b.b.y) ||
        Math.max(b.a.y, b.b.y) + r < Math.min(a.a.y, a.b.y)
      )
        continue
      const distance = segmentDistance([a.a, a.b], [b.a, b.b])
      if (distance < r - 1e-7)
        contacts.push({
          socTrace: a.id,
          carrierTrace: b.id,
          layer: a.layer,
          distance,
          r,
        })
    }
  reports.push({
    profile,
    socCenter: soc.center,
    ramCenter: ram.center,
    socFanoutBounds: socBounds,
    retainedCarrierBounds: tailBounds,
    xyBoundsOverlap:
      Math.min(socBounds.maxX, tailBounds.maxX) >
        Math.max(socBounds.minX, tailBounds.minX) &&
      Math.min(socBounds.maxY, tailBounds.maxY) >
        Math.max(socBounds.minY, tailBounds.minY),
    selectedViasInsideSocFanoutBounds: corridors.filter(
      (c) => c.viaInsideSocFanoutBounds,
    ).length,
    shorterThan1mm: corridors.filter((c) => c.gapMm < 1).length,
    differentNetCopperContacts: contacts.length,
    contactExamples: contacts.slice(0, 10),
    corridors,
  })
  console.log(
    profile,
    JSON.stringify({
      ...reports.at(-1),
      corridors: undefined,
      contactExamples: undefined,
    }),
  )
}
await Bun.write(
  "ddr-fixture-audit.json",
  `${JSON.stringify(reports, null, 2)}\n`,
)
