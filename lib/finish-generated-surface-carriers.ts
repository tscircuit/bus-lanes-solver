import { finishSurfaceTiming } from "./finish-surface-timing"
import { joinSignalEscapes } from "./join-signal-escapes"
import { joinedSignalGeometryIsValid } from "./joined-signal-geometry"
import { retargetGeneratedEscape } from "./retarget-generated-escape"
import type { SimpleRouteJson, SolverOptions, Trace } from "./types"

interface GeneratedSurfaceCarrierInput {
  input: SimpleRouteJson
  carriers: Trace[]
  escapes: Trace[]
  options: SolverOptions
  maxSteps: number
}

export interface CompletedGeneratedSurfaceCarriers {
  input: SimpleRouteJson
  carriers: Trace[]
  escapes: Trace[]
  traces: Trace[]
}

/** Fold solver-owned native surface approaches into the carrier BEFORE its
 * cleanup and matching pass. The existing normalizer replaces those exact
 * generated objects in the private copper ledger, never supplied fanouts.
 * Full pad endpoints, physical length and join turns then share one validator. */
export function* finishGeneratedSurfaceCarriers(
  params: GeneratedSurfaceCarrierInput,
): Generator<void, CompletedGeneratedSurfaceCarriers | null> {
  const { input, carriers, options, maxSteps } = params
  const escapes = params.escapes.map((escape) => {
    const carrier = carriers.find(
      (trace) => trace.connection_name === escape.connection_name,
    )
    const point = carrier?.route[0]
    if (!point || point.route_type !== "wire")
      throw Error(
        `Missing carrier for generated approach ${escape.connection_name}`,
      )
    return retargetGeneratedEscape(escape, point.layer)
  })
  const result = yield* finishSurfaceTiming(
    {
      native: input,
      pending: input,
      escapes,
      retained: [],
      traces: carriers,
    },
    options,
    { preserveTiming: true, maxSteps },
  )
  if (!result) return null
  const completedCarriers = [...result.retained, ...result.traces]
  const traces = completedCarriers.map((carrier) =>
    joinSignalEscapes(
      carrier,
      result.escapes.filter(
        (escape) => escape.connection_name === carrier.connection_name,
      ),
    ),
  )
  if (
    traces.some(
      (trace) =>
        !joinedSignalGeometryIsValid({
          input,
          trace,
          smoothTuning: options.smoothTuning,
        }),
    )
  )
    return null
  return {
    input: result.pending,
    carriers: completedCarriers,
    escapes: result.escapes,
    traces,
  }
}
