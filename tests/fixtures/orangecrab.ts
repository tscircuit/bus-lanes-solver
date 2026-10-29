import { readFileSync } from "node:fs"
import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson } from "../../lib"
import provenance from "./orangecrab-r0.2.1/provenance.json"

export function orangecrabCircuit(unrouted = false): AnyCircuitElement[] {
  const elements: AnyCircuitElement[] = JSON.parse(
    readFileSync(
      new URL("./orangecrab-r0.2.1/original.circuit.json", import.meta.url),
      "utf8",
    ),
  )
  const removed = new Set<string>(provenance.removed_copper_ids)
  return unrouted
    ? elements.filter(
        (e) =>
          !(e.type === "pcb_trace" && removed.has(e.pcb_trace_id)) &&
          !(e.type === "pcb_via" && removed.has(e.pcb_via_id)),
      )
    : elements
}

export function orangecrabByte0(): SimpleRouteJson {
  return JSON.parse(
    readFileSync(
      new URL("./orangecrab-r0.2.1/byte0.srj.json", import.meta.url),
      "utf8",
    ),
  )
}
