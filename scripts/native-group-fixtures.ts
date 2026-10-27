import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import type { SimpleRouteJson } from "../lib/types"
import manifest from "../tests/fixtures/am3352-native-groups/manifest.json"
export type NativeGroupSample = "ram-minus29" | "ram-minus25"
export function loadNativeGroupFixture(sample: NativeGroupSample) {
  const read = (suffix: "input.json" | "native.json") => {
    const name = `${sample}.${suffix}.gz` as keyof typeof manifest
    const data = gunzipSync(
      readFileSync(
        new URL(
          `../tests/fixtures/am3352-native-groups/${name}`,
          import.meta.url,
        ),
      ),
    )
    if (
      createHash("sha256").update(data).digest("hex") !== manifest[name].sha256
    )
      throw Error("Native group fixture hash mismatch")
    return JSON.parse(data.toString())
  }
  return {
    input: read("input.json") as SimpleRouteJson,
    native: read("native.json") as any[],
  }
}
