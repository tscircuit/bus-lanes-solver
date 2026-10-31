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
    "17df6cb0f47bbc35972e06d0d01801d0eec11f6552874b34e8e9670224b47d0b" ||
  circuit.some((element) => element.type === "pcb_trace")
)
  throw Error("Expected the original failed OrangeCrab byte-one baseline")
writeSnapshot({ circuit, directory, status: "failed_baseline" })
