import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { writeSnapshot } from "./snapshot"
import type { AnyCircuitElement } from "circuit-json"

// The dedicated reproduction intentionally publishes this labeled failure.
// Completed routes still go through validate.ts and every acceptance check.
const label = process.argv[2] ?? "before"
const directory = `${import.meta.dir}/results/${label}`
const summary = JSON.parse(readFileSync(`${directory}/summary.json`, "utf8"))
const input = JSON.parse(readFileSync(`${directory}/input.srj.json`, "utf8"))
const inputSha256 = createHash("sha256")
  .update(JSON.stringify(input))
  .digest("hex")
const circuit: AnyCircuitElement[] = JSON.parse(
  readFileSync(`${directory}/circuit.json`, "utf8"),
)
if (
  summary.solved ||
  summary.traces !== 0 ||
  summary.vias !== 0 ||
  summary.pads !== 387 ||
  !summary.asyncErrors.some((error: string) =>
    error.includes("No shared tuning corridor"),
  ) ||
  inputSha256 !==
    "2a8ca16a2ef74245214dcc64aa03c7bed86c4013e74fe2819c8cebcba83c9825" ||
  circuit.some((element) => element.type === "pcb_trace")
)
  throw Error("Expected the original failed OrangeCrab byte-zero baseline")
writeSnapshot({ circuit, directory, status: "failed-baseline" })
