import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { SimpleRouteJson } from "../lib/types"

export const H3_NATIVE_CARRIER_INPUT_SHA256 =
  "5f157c9638526056eefb3e5dda5e262e71f7c9bfd7baf2c4cd09b6418cea4a11"

export function loadH3NativeCarrierInput(): SimpleRouteJson {
  const fixture = new URL("../tests/fixtures/h3-native-carrier/input.srj.json", import.meta.url)
  const raw = readFileSync(fixture, "utf8")
  if (createHash("sha256").update(raw).digest("hex") !== H3_NATIVE_CARRIER_INPUT_SHA256)
    throw Error("H3 source fixture changed")
  const input: SimpleRouteJson = JSON.parse(raw)
  if (input.connections.length !== 11 || input.obstacles.length !== 479 || input.layerCount !== 2 || input.traces?.length !== 0)
    throw Error("H3 fixture must retain eleven original connections, 479 pads, two layers and no saved copper")
  return input
}
