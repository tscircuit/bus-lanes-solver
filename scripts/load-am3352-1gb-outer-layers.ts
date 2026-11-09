import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson } from "../lib/types"
import metadata from "../tests/fixtures/am3352-1gb-outer-layers/metadata.json"
import provenance from "../tests/fixtures/am3352-1gb-outer-layers/provenance.json"

export const am3352OneGbOuterLayersInputSha256 =
  "84e1668ef4e27390c157f11aad3694b323bfb1a3d1f140bbd8891e0e851ada11"

export const am3352OneGbOuterLayersInputGzipSha256 =
  "c6f8ecab9a22e5b7a7c66f5f846a00849c871fd296d5158f95ccd6a9fa21809a"

export const am3352OneGbOuterLayersMetadata = metadata
export const am3352OneGbOuterLayersProvenance = provenance
export const am3352OneGbOuterLayersRecordedBundleSha256 =
  provenance.observedPackage.files["dist/index.js"].sha256

/** Exact 0.0.35 input capture in board-world mm (+X right, +Y up).
 * Preserve all original fields, IDs, pads, constraints and omitted copper.
 * Loading and checking this fixture never constructs or steps a solver. */
export function loadAm3352OneGbOuterLayersInput(): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      "../tests/fixtures/am3352-1gb-outer-layers/input.simple-route.json.gz",
      import.meta.url,
    ),
  )
  const bytes = gunzipSync(compressed)
  const sha256 = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex")
  if (
    sha256(compressed) !== am3352OneGbOuterLayersInputGzipSha256 ||
    sha256(bytes) !== am3352OneGbOuterLayersInputSha256
  )
    throw Error("AM3352 1 GB outer-layer input bytes changed")

  const input = JSON.parse(bytes.toString("utf8")) as SimpleRouteJson
  if (
    input.connections.length !== 50 ||
    input.obstacles.length !== 420 ||
    (input.traces?.length ?? 0) !== 0
  )
    throw Error("Unexpected AM3352 1 GB outer-layer input counts")
  return input
}
