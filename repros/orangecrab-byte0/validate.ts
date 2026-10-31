import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Resvg } from "@resvg/resvg-js"
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
  traces.length &&
  (traces.length !== 11 ||
    physical?.length ||
    matching?.length ||
    !native?.drc.valid ||
    !native.connectivity.valid ||
    native.connectivity.connectedEndpointCount !== 22)
)
  throw Error("Refusing an incomplete or invalid routed snapshot")
const svg = convertCircuitJsonToPcbSvg(json, {
  backgroundColor: "white",
  width: 1400,
  height: 1100,
  shouldDrawRatsNest: false,
  shouldDrawErrors: false,
  showErrorsInTextOverlay: false,
  viewport: { minX: -7, minY: -12, maxX: 23, maxY: 10.5 },
})
writeFileSync(`${directory}/board.svg`, svg)
writeFileSync(`${directory}/board.png`, new Resvg(svg).render().asPng())
