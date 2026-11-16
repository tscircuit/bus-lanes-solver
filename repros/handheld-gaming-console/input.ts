import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { SimpleRouteJson } from "../../lib/types"

export function loadInput(): SimpleRouteJson {
  const raw = readFileSync(
    new URL(
      "../../tests/fixtures/handheld-gaming-console/input.srj.json",
      import.meta.url,
    ),
  )
  const metadata = JSON.parse(
    readFileSync(new URL("./provenance.json", import.meta.url), "utf8"),
  )
  if (createHash("sha256").update(raw).digest("hex") !== metadata.input_sha256)
    throw Error("Handheld immutable fixture hash mismatch")
  return JSON.parse(raw.toString())
}
