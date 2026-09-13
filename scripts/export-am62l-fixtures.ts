import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
const LAYOUT_PROFILES = [
  "ddr_left_io_right",
  "ddr_top_io_bottom",
  "ddr_right_io_left",
  "ddr_bottom_io_top",
]
const moduleDir = process.argv[2]
if (!moduleDir) throw Error("Pass the AM62L module directory")
const out = "tests/fixtures"
for (const profile of LAYOUT_PROFILES) {
  const input = await Bun.file(
    `${moduleDir}/previews/ram/${profile}.phase-3.input.json`,
  ).json()
  const json = await Bun.file(
      `${moduleDir}/dist/${profile}/circuit.json`,
    ).json(),
    map = getFullConnectivityMapFromCircuitJson(json)
  // The captured inputs and final circuit use stable source-trace IDs.
  const sources = new Map(
    json
      .filter((e: any) => e.type === "source_trace")
      .map((e: any) => [e.source_trace_id, e]),
  )
  await Bun.write(`${out}/${profile}-raw.json`, JSON.stringify(input))
  for (const bank of ["BYTE0", "BYTE1", "CA"]) {
    const chosen = input.connections.filter((c: any) => {
      const signal =
        (sources.get(c.source_trace_id ?? c.name) as any)?.name?.replace(
          "RAM_",
          "",
        ) ?? ""
      return bank === "BYTE0"
        ? /^DDR0_(DQ[0-7]$|DM0|DQS0)/.test(signal)
        : bank === "BYTE1"
          ? /^DDR0_(DQ(?:8|9|1[0-5])$|DM1|DQS1)/.test(signal)
          : /^DDR0_/.test(signal) && !/^DDR0_(DQ|DM)/.test(signal)
    })
    const connectionByNet = new Map(
      chosen.map((c: any) => [
        map.getNetConnectedToId(c.source_trace_id ?? c.name),
        c.name,
      ]),
    )
    const next = structuredClone(input)
    next.connections = structuredClone(chosen)
    next.buses = (input.buses ?? [])
      .filter((b: any) =>
        b.connectionNames.some((n: string) =>
          chosen.some((c: any) => c.name === n),
        ),
      )
      .map((b: any) => ({
        ...b,
        connectionNames: b.connectionNames.filter((n: string) =>
          chosen.some((c: any) => c.name === n),
        ),
      }))
    next.traces = []
    for (const trace of json.filter((e: any) => e.type === "pcb_trace")) {
      const owner =
        connectionByNet.get(map.getNetConnectedToId(trace.source_trace_id)) ??
        `fixed:${trace.source_trace_id}`
      const c = next.connections.find(
        (c: any) => (c.source_trace_id ?? c.name) === trace.source_trace_id,
      )
      let route = structuredClone(trace.route)
      if (c && !trace.pcb_trace_id.startsWith("saved_fanout")) {
        const viaIndex = route.findIndex((p: any) => p.route_type === "via")
        if (viaIndex < 0) throw Error("Expected carrier escape via")
        const via = route[viaIndex],
          start = c.pointsToConnect.find((p: any) => !p.pcb_port_id)
        if (!start || start.layer !== via.from_layer)
          throw Error("Unexpected carrier route orientation")
        c.pointsToConnect = [
          start,
          {
            x: via.x,
            y: via.y,
            layer: via.from_layer,
            pointId: `fixed_ram_escape_${c.name}`,
          },
        ]
        route = route.slice(viaIndex)
      }
      for (const p of route)
        if (p.route_type === "via") {
          const physical = json.find(
            (e: any) =>
              e.type === "pcb_via" &&
              e.pcb_trace_id === trace.pcb_trace_id &&
              Math.hypot(e.x - p.x, e.y - p.y) < 1e-6,
          )
          if (physical) p.layers = physical.layers
        }
      next.traces.push({
        type: "pcb_trace",
        pcb_trace_id: trace.pcb_trace_id,
        source_trace_id: trace.source_trace_id,
        connection_name: owner,
        route,
      })
    }
    await Bun.write(
      `${out}/${profile}-${bank.toLowerCase()}.json`,
      JSON.stringify(next),
    )
  }
}
