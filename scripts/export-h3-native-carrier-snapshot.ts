import { mkdirSync, writeFileSync } from "node:fs"
import { runH3NativeCarrierRepro } from "./repro-h3-native-carrier"

const report = runH3NativeCarrierRepro()
if (
  !report.inputUnchanged ||
  (report.solver.solved && !report.validation?.valid)
)
  throw Error(
    "Refusing to export independently rejected H3 copper or route quality",
  )
if (!report.solver.solved && !process.argv.includes("--allow-failed"))
  throw Error(
    "An explicitly requested failed diagnostic requires --allow-failed",
  )
const directory = new URL("../docs/h3-native-carrier/", import.meta.url)
mkdirSync(directory, { recursive: true })
writeFileSync(new URL("result.snap.svg", directory), report.svg)
console.log(
  JSON.stringify(
    {
      solved: report.solver.solved,
      failed: report.solver.failed,
      error: report.solver.error,
      validation: report.validation,
      inputUnchanged: report.inputUnchanged,
    },
    null,
    2,
  ),
)
