import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import {
  matchNativeCarrierSignals,
  type NativeCarrierMatchingOptions,
  type NativeCarrierProgress,
} from "./match-native-carrier-signals"
import {
  planNativePairedCarriers,
  type NativePairedCarrierOptions,
} from "./plan-native-paired-carriers"
import { nativeCarrierLayers } from "./native-carrier-layers"
import type { SimpleRouteJson, Trace } from "./types"

export interface NativeSingleCarrierOptions
  extends NativePairedCarrierOptions,
    NativeCarrierMatchingOptions {}

export function nativeSingleCarrierEligible(
  input: SimpleRouteJson,
  options: NativeSingleCarrierOptions = {},
) {
  const carrier = options.carrierLayer ?? input.allowedLayers?.[0]
  return (
    (options.carrierLayer !== undefined || input.allowedLayers?.length === 1) &&
    !!carrier &&
    (options.carrierLayer !== undefined
      ? carrier !== "top"
      : /^inner\d+$/.test(carrier)) &&
    getCopperLayerNames(input.layerCount).includes(carrier) &&
    !!input.allowedLayers?.includes(carrier) &&
    !!input.differentialPairs?.length &&
    input.connections.every(
      (c) =>
        c.pointsToConnect.length === 2 &&
        c.pointsToConnect.every((p) => p.layer === "top"),
    )
  )
}

export function* routeMatchedNativeSingleCarrier(
  input: SimpleRouteJson,
  options: NativeSingleCarrierOptions = {},
  progress?: (state: NativeCarrierProgress) => void,
): Generator<void, Trace[] | null> {
  if (!nativeSingleCarrierEligible(input, options)) return null
  const { primary } = nativeCarrierLayers({ input, options })
  if (
    input.connections.some(
      (c) =>
        (c.width ?? c.nominalTraceWidth ?? input.minTraceWidth) !==
        input.minTraceWidth,
    ) ||
    input.buses?.some(
      (b) => b.traceWidth !== undefined && b.traceWidth !== input.minTraceWidth,
    )
  )
    throw Error("Native single-carrier matching requires uniform signal widths")
  if (
    input.buses?.some(
      (b) => b.allowedLayers && !b.allowedLayers.includes(primary),
    )
  )
    throw Error("A bus excludes the selected native carrier layer")
  const owners = new Set(
    [...input.connections, ...(options.fixedConnections ?? [])].map(
      (c) => c.name,
    ),
  )
  if (
    input.traces?.some(
      (t) => !t.connection_name || !owners.has(t.connection_name),
    )
  )
    throw Error(
      "Supply fixedConnections for all immutable traces not owned by routing requests",
    )
  const paired = yield* planNativePairedCarriers(
    { ...input, allowedLayers: [primary] },
    options,
    (stage) =>
      progress?.({ stage, pass: 0, collisions: 0, unfinished: [], traces: [] }),
  )
  if (!paired) return null
  return yield* matchNativeCarrierSignals(input, paired, options, progress)
}
