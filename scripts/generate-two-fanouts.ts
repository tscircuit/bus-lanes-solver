import { routeGrid } from "./lib/ram-fanout-grid"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
const moduleDir = process.argv[2] ?? "../am62l-module"
const profiles = [
  "ddr_left_io_right",
  "ddr_right_io_left",
  "ddr_top_io_bottom",
  "ddr_bottom_io_top",
]
const bounds = (points: any[], r = 0) => ({
  minX: Math.min(...points.map((p) => p.x)) - r,
  maxX: Math.max(...points.map((p) => p.x)) + r,
  minY: Math.min(...points.map((p) => p.y)) - r,
  maxY: Math.max(...points.map((p) => p.y)) + r,
})
for (const profile of process.argv.length > 3
  ? process.argv.slice(3)
  : profiles) {
  const raw = await Bun.file(`tests/fixtures/${profile}-raw.json`).json()
  const json = await Bun.file(
      `${moduleDir}/dist/${profile}/circuit.json`,
    ).json(),
    map = getFullConnectivityMapFromCircuitJson(json)
  const component = (name: string) =>
    json.find(
      (e: any) =>
        e.type === "pcb_component" &&
        e.source_component_id ===
          json.find(
            (s: any) => s.type === "source_component" && s.name === name,
          ).source_component_id,
    )
  const soc = component("U1"),
    ram = component("RAM")
  const d = profile.includes("ddr_left")
    ? { x: -1, y: 0 }
    : profile.includes("ddr_right")
      ? { x: 1, y: 0 }
      : profile.includes("ddr_top")
        ? { x: 0, y: 1 }
        : { x: 0, y: -1 }
  const nameByNet = new Map(
    raw.connections.map((c: any) => [
      map.getNetConnectedToId(c.source_trace_id ?? c.name),
      c.name,
    ]),
  )
  const socTraces = json
    .filter(
      (t: any) =>
        t.type === "pcb_trace" &&
        t.pcb_trace_id.startsWith("saved_fanout") &&
        nameByNet.has(map.getNetConnectedToId(t.source_trace_id)),
    )
    .map((t: any) => ({
      ...t,
      connection_name: nameByNet.get(
        map.getNetConnectedToId(t.source_trace_id),
      ),
      source_trace_id: nameByNet.get(
        map.getNetConnectedToId(t.source_trace_id),
      ),
    }))
  if (socTraces.length !== 33)
    throw Error(`Expected 33 independent SoC paths, got ${socTraces.length}`)
  const socPads = raw.obstacles.filter(
    (o: any) => o.componentId === soc.pcb_component_id,
  )
  const socRegion = bounds(
    [
      ...socTraces.flatMap((t: any) => t.route),
      ...socPads.flatMap((o: any) => [
        { x: o.center.x - o.width / 2, y: o.center.y - o.height / 2 },
        { x: o.center.x + o.width / 2, y: o.center.y + o.height / 2 },
      ]),
    ],
    0.2,
  )
  const transverseOffset = d.y
    ? Math.round(
        raw.connections.reduce(
          (s: number, c: any) =>
            s + c.pointsToConnect.find((p: any) => !p.pcb_port_id).x,
          0,
        ) /
          33 /
          0.025,
      ) * 0.025
    : 0
  const ramInput = structuredClone(raw)
  ramInput.traces = []
  ramInput.obstacles = raw.obstacles
    .filter((o: any) => o.componentId === ram.pcb_component_id)
    .map((o: any) => ({
      ...o,
      center: { x: o.center.x - ram.center.x, y: o.center.y - ram.center.y },
    }))
  ramInput.bounds = { minX: -18, maxX: 18, minY: -18, maxY: 18 }
  ramInput.connections = raw.connections.map((c: any) => {
    const pad = c.pointsToConnect.find((p: any) => p.pcb_port_id),
      exit = c.pointsToConnect.find((p: any) => !p.pcb_port_id)
    return {
      ...c,
      pointsToConnect: [
        { ...pad, x: pad.x - ram.center.x, y: pad.y - ram.center.y },
        {
          ...exit,
          ...(d.x
            ? { x: -d.x * 17.5 }
            : { x: exit.x - transverseOffset, y: -d.y * 17.5 }),
        },
      ],
    }
  })
  const sequence = Object.fromEntries(
    ramInput.connections.map((c: any) => [
      c.name,
      d.y
        ? [
            [
              "top",
              c.pointsToConnect[1].layer === "inner2" ? "inner4" : "inner2",
              "bottom",
              c.pointsToConnect[1].layer,
            ],
          ]
        : [["top", "bottom", c.pointsToConnect[1].layer]],
    ]),
  )
  const sequenceGroups = Object.fromEntries(
    ramInput.connections.map((c: any) => {
      const name =
        json.find(
          (t: any) =>
            t.type === "source_trace" &&
            t.source_trace_id === c.source_trace_id,
        )?.name ?? c.name
      return [c.name, /DQS|CK0/.test(name) ? name.replace(/_n$/, "") : c.name]
    }),
  )
  let ramTraces: any[] | undefined,
    first: string[] = []
  if (process.env.REUSE_RAM_FANOUT === "1") {
    const cached = await Bun.file(`.cache/${profile}-ram-generated.json`).json()
    if (JSON.stringify(cached.input) !== JSON.stringify(ramInput))
      throw Error("Cached RAM input changed")
    ramTraces = cached.traces
  }
  for (let attempt = 0; attempt < 80 && !ramTraces; attempt++)
    try {
      ramTraces = routeGrid(ramInput, {
        generic: true,
        exitDirection: { x: -d.x, y: -d.y },
        allowBlindVias: true,
        halfSize: 18,
        stepMm: 0.025,
        first,
        layerSequences: sequence,
        layerSequenceGroups: sequenceGroups,
      })
    } catch (e) {
      console.log(profile, "retry", attempt, (e as Error).message)
      const name = (e as any).connection
      if (!name) throw e
      first = [name, ...first.filter((n) => n !== name)]
    }
  if (!ramTraces) throw Error(`RAM fanout failed: ${profile}`)
  const ramDrc = validateRoutedCopperDrc({
    inputSrj: ramInput,
    routedSrj: { ...ramInput, traces: ramTraces },
    clearance: 0.075,
    allowBlindAndBuriedVias: true,
  })
  if (!ramDrc.valid) throw Error(JSON.stringify(ramDrc.issues.slice(0, 5)))
  const regionHalf = 18.2
  const margin = 6,
    shift = {
      x: d.x
        ? d.x < 0
          ? socRegion.minX - margin - regionHalf
          : socRegion.maxX + margin + regionHalf
        : transverseOffset,
      y: d.y
        ? d.y < 0
          ? socRegion.minY - margin - regionHalf
          : socRegion.maxY + margin + regionHalf
        : 0,
    }
  const move = (p: any) => ({ ...p, x: p.x + shift.x, y: p.y + shift.y })
  const ramRegion = {
    minX: -regionHalf + shift.x,
    maxX: regionHalf + shift.x,
    minY: -regionHalf + shift.y,
    maxY: regionHalf + shift.y,
  }
  const fixedRam = ramTraces.map((t) => ({
    ...t,
    pcb_trace_id: `ram_fanout_${t.pcb_trace_id}`,
    route: t.route.map(move),
  }))
  const fixedSoc = socTraces.map((t: any) => ({
    ...t,
    pcb_trace_id: `soc_fanout_${t.pcb_trace_id}`,
  }))
  const input = {
    ...raw,
    connections: raw.connections.map((c: any) => ({
      ...c,
      pointsToConnect: [
        c.pointsToConnect.find((p: any) => !p.pcb_port_id),
        {
          ...move(
            ramInput.connections.find((r: any) => r.name === c.name)
              .pointsToConnect[1],
          ),
          pointId: `ram_exit_${c.name}`,
        },
      ],
    })),
    traces: [...fixedSoc, ...fixedRam],
    obstacles: [
      ...socPads,
      ...ramInput.obstacles.map((o: any) => ({ ...o, center: move(o.center) })),
    ],
    bounds: bounds(
      [
        { x: socRegion.minX, y: socRegion.minY },
        { x: socRegion.maxX, y: socRegion.maxY },
        { x: ramRegion.minX, y: ramRegion.minY },
        { x: ramRegion.maxX, y: ramRegion.maxY },
      ],
      3,
    ),
  }
  const originalConnections = input.connections.map((c: any) => ({
    ...c,
    pointsToConnect: [
      fixedSoc.find((t) => t.connection_name === c.name).route[0],
      fixedRam.find((t) => t.connection_name === c.name).route[0],
    ],
  }))
  const fixedDrc = validateRoutedCopperDrc({
    inputSrj: { ...input, connections: originalConnections, traces: [] },
    routedSrj: { ...input, connections: originalConnections },
    clearance: 0.075,
    allowBlindAndBuriedVias: true,
  })
  if (!fixedDrc.valid) throw Error(JSON.stringify(fixedDrc.issues.slice(0, 5)))
  const metadata = {
    profile,
    kind: "independent-fanouts",
    marginMm: margin,
    socRegion,
    ramRegion,
    ramFanoutDrc: ramDrc,
    fixedCopperDrc: fixedDrc,
    carrierTraceCount: 0,
    connectionCount: 33,
    ramLayerSequences: sequence,
    socCenter: soc.center,
    ramCenter: shift,
  }
  await Bun.write(`examples/data/${profile}.json`, JSON.stringify(input))
  await Bun.write(
    `examples/data/${profile}.meta.json`,
    `${JSON.stringify(metadata, null, 2)}\n`,
  )
  await Bun.write(
    `.cache/${profile}-ram-generated.json`,
    JSON.stringify({ input: ramInput, traces: ramTraces }),
  )
  console.log(profile, "fanouts ready", metadata.fixedCopperDrc.valid)
}
