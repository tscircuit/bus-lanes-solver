import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { writeSnapshot } from "./snapshot"
import {
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkViaTraceClearance,
  checkViaPadClearance,
  checkDifferentNetViaSpacing,
  checkViasInPads,
  checkTracesAreContiguous,
  checkPcbBusLengthSkew,
  checkPcbRoutingConstraints,
  checkPcbTraceSelfShorts,
} from "@tscircuit/checks"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "../../node_modules/@tscircuit/fanout-solver"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"
import { exteriorPairSpacingReports } from "../../lib/exterior-pair-spacing"
import type { AnyCircuitElement } from "circuit-json"
const root = `${import.meta.dir}/results`
const label = process.argv[2] ?? "after"
const directory = `${root}/${label}`
const input = JSON.parse(readFileSync(`${directory}/input.srj.json`, "utf8"))
const json: AnyCircuitElement[] = JSON.parse(
  readFileSync(`${directory}/circuit.json`, "utf8"),
)
const traces = json.filter((e) => e.type === "pcb_trace")
const clearance = input.minTraceToPadEdgeClearance
const physical = traces.length
  ? [
      ...checkEachPcbTraceNonOverlapping(json, { minClearance: clearance }),
      ...checkPadTraceClearance(json, { minClearance: clearance }),
      ...checkViaTraceClearance(json, { minClearance: clearance }),
      ...checkViaPadClearance(json, { minClearance: clearance }),
      ...checkDifferentNetViaSpacing(json),
      ...checkViasInPads(json),
      ...checkTracesAreContiguous(json),
      ...checkPcbTraceSelfShorts(json),
    ].filter((e) => e.type.endsWith("_error"))
  : null
const matching = traces.length
  ? [
      ...checkPcbBusLengthSkew(json),
      ...checkPcbRoutingConstraints(json),
    ].filter((e) => e.type.endsWith("_error"))
  : null
const summary = JSON.parse(readFileSync(`${directory}/summary.json`, "utf8"))
const output = traces.length
  ? JSON.parse(readFileSync(`${directory}/output.srj.json`, "utf8"))
  : null
const native = output
  ? {
      connectivity: validateOriginalEndpointConnectivity({
        inputSrj: input,
        routedSrj: output,
      }),
      drc: validateRoutedCopperDrc({
        inputSrj: input,
        routedSrj: output,
        clearance,
        allowBlindAndBuriedVias: false,
      }),
      buses: busLengthReports(input, output.traces),
      pairs: pairLengthReports(input, output.traces),
      exterior: exteriorPairSpacingReports(input, output.traces),
    }
  : null
const report = {
  ...summary,
  inputSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  physical,
  matching,
  native,
}
writeFileSync(`${directory}/validation.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
if (
  !summary.solved ||
  summary.asyncErrors.length ||
  traces.length !== 22 ||
  summary.vias !== 44 ||
  summary.pads !== 387 ||
  summary.sourceTraces !== 51 ||
  physical?.length ||
  matching?.length ||
  !native?.drc.valid ||
  !native.connectivity.valid ||
  native.connectivity.connectedEndpointCount !== 44 ||
  native.buses.some(
    (bus) =>
      !bus.matched ||
      !bus.aboveMinimumLength ||
      !bus.withinLengthLimit ||
      bus.skewMm > 0.5,
  ) ||
  native.pairs.some((pair) => !pair.matched || pair.skewMm > 0.1) ||
  native.exterior.some((pair) => !pair.matched)
)
  throw Error("Refusing an incomplete or invalid routed snapshot")
writeSnapshot({ circuit: json, directory, status: "completed" })
