import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import type { SimpleRouteJson } from "./types"

export interface NativeCarrierLayerOptions {
  /** Explicit paired carrier when the input permits more than one layer. */
  carrierLayer?: string
  /** Ordered ordinary-signal alternatives, each permitted by the original input. */
  ordinaryCarrierLayers?: string[]
}

export function nativeCarrierLayers({
  input,
  options,
}: {
  input: SimpleRouteJson
  options: NativeCarrierLayerOptions
}) {
  const primary = options.carrierLayer ?? input.allowedLayers?.[0]
  const physical = getCopperLayerNames(input.layerCount)
  const ordinary = [
    ...new Set(options.ordinaryCarrierLayers ?? (primary ? [primary] : [])),
  ]
  if (
    !primary ||
    !ordinary.length ||
    [primary, ...ordinary].some(
      (layer) =>
        layer === "top" ||
        !physical.includes(layer) ||
        !input.allowedLayers?.includes(layer),
    )
  )
    throw Error(
      "Native carriers must be non-TOP physical layers permitted by the input",
    )
  return { primary, ordinary }
}
