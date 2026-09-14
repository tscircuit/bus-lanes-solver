import React from "react"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { TwoFanouts } from "../examples/TwoFanouts"
const coreDir = process.argv[2]
if (!coreDir)
  throw Error(
    "Pass a core checkout with bus_lanes integration and dependencies installed",
  )
const { Circuit } = await import(
  pathToFileURL(resolve(coreDir, "lib/index.ts")).href
)
const captureOnly = process.argv.includes("--capture-only")
const selectedProfiles = process.argv
  .slice(3)
  .filter((a) => !a.startsWith("--"))
for (const profile of selectedProfiles.length
  ? selectedProfiles
  : [
      "ddr_left_io_right",
      "ddr_right_io_left",
      "ddr_top_io_bottom",
      "ddr_bottom_io_top",
    ]) {
  const input = await Bun.file(`examples/data/${profile}.json`).json(),
    metadata = await Bun.file(`examples/data/${profile}.meta.json`).json()
  const circuit = new Circuit(),
    captures: any[] = []
  circuit.on("autorouting:start", (event: any) => {
    if (event.simpleRouteJson?.connections?.length === 33) {
      captures.push(structuredClone(event.simpleRouteJson))
      if (event.simpleRouteJson.traces?.length === 66)
        Bun.write(
          `.cache/${profile}.phase-circuit.json`,
          JSON.stringify(circuit.getCircuitJson()),
        )
      if (captureOnly && event.simpleRouteJson.traces?.length === 66)
        throw Error("CAPTURE_ONLY_COMPLETE")
      Bun.write(
        `.cache/${profile}.pending-phase.json`,
        JSON.stringify(event.simpleRouteJson),
      )
    }
  })
  circuit.add(<TwoFanouts input={input} metadata={metadata} />)
  try {
    await circuit.renderUntilSettled()
  } catch (e) {
    if (!captureOnly || !captures.some((c) => c.traces?.length === 66)) throw e
  }
  const json = circuit.getCircuitJson(),
    errors = json.filter((e: any) => e.type.includes("error"))
  if (
    !captureOnly &&
    errors.some(
      (e: any) =>
        !["pcb_autorouting_error", "pcb_port_not_connected_error"].includes(
          e.type,
        ),
    )
  )
    throw Error(
      `${profile}: unexpected circuit error ${JSON.stringify(errors.slice(0, 5))}`,
    )
  const phase = captures.at(-1)
  if (!phase || phase.traces?.length !== 66)
    throw Error("Expected 33 exit-to-exit DDR connections")
  const fanouts = captureOnly
    ? phase.traces
    : json.filter(
        (e: any) =>
          e.type === "pcb_trace" && e.pcb_trace_id.startsWith("saved_fanout"),
      )
  const carriers = json.filter(
    (e: any) =>
      e.type === "pcb_trace" && !e.pcb_trace_id.startsWith("saved_fanout"),
  )
  if (
    fanouts.length !== 66 ||
    (carriers.length !== 33 && errors.length === 0 && !captureOnly) ||
    carriers.some((t: any) => t.route.some((p: any) => p.route_type !== "wire"))
  )
    throw Error("Expected 66 fanout paths and 33 via-free carrier paths")
  const inRegion = (p: any, b: any) =>
    p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
  const sides = fanouts.map((t: any) => ({
    ...t,
    side: inRegion(t.route[0], metadata.socRegion) ? "soc" : "ram",
  }))
  if (
    sides.some((t: any) =>
      t.route.some((p: any) => !inRegion(p, metadata[`${t.side}Region`])),
    )
  )
    throw Error("Fanout escaped its own region")
  const sideNames = (side: string) =>
    new Set(
      sides
        .filter((t: any) => t.side === side)
        .map((t: any) => t.source_trace_id),
    )
  if (sideNames("soc").size !== 33 || sideNames("ram").size !== 33)
    throw Error("Incomplete per-side coverage")
  const meta = {
    ...metadata,
    kind: "captured-bus-lanes-phase",
    fixedFanoutTraces: sides,
    corePhase: {
      name: "DDR_INTERCONNECT",
      autorouter: "bus_lanes",
      connections: 33,
      fanoutTraces: 66,
      carrierInputTraces: (phase.traces ?? []).filter(
        (t: any) =>
          !fanouts.some((f: any) => f.pcb_trace_id === t.pcb_trace_id),
      ).length,
      carrierOutputTraces: carriers.length,
      status: captureOnly ? "input_only" : "completed",
      circuitErrors: captureOnly ? null : errors.length,
      routingErrors: captureOnly
        ? []
        : errors.filter((e: any) => e.type === "pcb_autorouting_error"),
    },
    signalNames: Object.fromEntries(
      json
        .filter((e: any) => e.type === "source_trace")
        .map((e: any) => [e.source_trace_id, e.name]),
    ),
  }
  await Bun.write(
    `tests/fixtures/two-fanouts/${profile}.json`,
    JSON.stringify(phase),
  )
  await Bun.write(
    `tests/fixtures/two-fanouts/${profile}.meta.json`,
    JSON.stringify(meta),
  )
  await Bun.write(
    `.cache/${profile}.two-fanouts.circuit.json`,
    JSON.stringify(json),
  )
  console.log(
    `${profile}: captured actual bus_lanes input; 66 fanout paths, ${carriers.length} carriers, ${captureOnly ? "routing not run (input capture only)" : `${errors.length} circuit errors`}`,
  )
}
