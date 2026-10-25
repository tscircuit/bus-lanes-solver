import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { runRotatedPairHandoffCase } from "./rotated-pair-handoff-case"
const entry = resolve(process.argv[2] ?? "lib/coupled-pair-routing.ts"),
  { routeCoupledPair } = await import(pathToFileURL(entry).href),
  result = runRotatedPairHandoffCase(routeCoupledPair),
  report = {
    solverRevision: Bun.spawnSync([
      "git",
      "-C",
      resolve(entry, "../.."),
      "rev-parse",
      "HEAD",
    ])
      .stdout.toString()
      .trim(),
    runtime: Bun.version,
    fixtureSha256: createHash("sha256")
      .update(
        readFileSync(
          new URL(
            "../tests/fixtures/rotated-pair-handoff/input.json",
            import.meta.url,
          ),
        ),
      )
      .digest("hex"),
    stepsPerCase: 2_000_000,
    wallSecondsPerCase: 3600,
    accepted: result.accepted,
    geometryEqual: result.geometryEqual,
    cases: result.cases.map((c) => c.report),
  }
console.log(JSON.stringify(report, null, 2))
if (process.argv[3]) {
  mkdirSync(resolve(process.argv[3], ".."), { recursive: true })
  writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n")
}
if (!result.accepted) process.exitCode = 1
