import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { runNativeSmtPairCase } from "./native-smt-pair-case"
const { BusLanesPipelineSolver } = await import(
  pathToFileURL(resolve(process.argv[2] ?? "lib/index.ts")).href
)
const { report } = runNativeSmtPairCase(BusLanesPipelineSolver)
const result = {
  ...report,
  runtime: Bun.version,
  fixtureSha256: createHash("sha256")
    .update(
      readFileSync(
        new URL(
          "../tests/fixtures/native-smt-pair/input.json",
          import.meta.url,
        ),
      ),
    )
    .digest("hex"),
  revision: Bun.spawnSync([
    "git",
    "-C",
    resolve(process.argv[2] ?? "lib/index.ts", "../.."),
    "rev-parse",
    "HEAD",
  ])
    .stdout.toString()
    .trim(),
}
console.log(JSON.stringify(result, null, 2))
if (process.argv[3])
  writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + "\n")
if (!result.accepted) process.exitCode = 1
