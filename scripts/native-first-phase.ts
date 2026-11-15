import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { routeCoupledPair } from "../lib/coupled-pair-routing"
import { fixedCopper } from "../lib/vector-scene"
import { runBoundedRouting } from "../lib/run-bounded-routing"
import { maximumCarrierLength, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { length } from "../lib/geometry"
import type { SimpleRouteJson, Trace } from "../lib/types"

export function loadFirstPhaseNativeByte(): SimpleRouteJson {
  return JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../tests/fixtures/native-first-phase/rotated-byte1.simple-route.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
}
export function* firstPhasePairControl(input: SimpleRouteJson) {
  return yield* runBoundedRouting(
    routeCoupledPair(input, input.differentialPairs![0], fixedCopper(input), {
      copper: [],
      penalty: 0,
      variant: 0,
      preferPackageOnlyTuning: true,
    }),
    60000,
  )
}
export function auditFirstPhasePair(input: SimpleRouteJson, traces: Trace[]) {
  const names = new Set(input.differentialPairs![0].connectionNames)
  const scoped = {
    ...input,
    connections: input.connections.filter((c) => names.has(c.name)),
  }
  const connected =
    traces.length === 2 &&
    scoped.connections.every((c) => {
      const t = traces.find((t) => t.connection_name === c.name)
      return (
        !!t &&
        [0, 1].every((i) => {
          const p = i ? t.route.at(-1)! : t.route[0],
            q = c.pointsToConnect[i]
          return (
            p.route_type === "wire" &&
            p.layer === q.layer &&
            Math.hypot(p.x - q.x, p.y - q.y) < 1e-8
          )
        })
      )
    })
  const drc = validateRoutedCopperDrc({
    inputSrj: scoped as never,
    routedSrj: { ...scoped, traces } as never,
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  const withinLimits = traces.every(
    (t) =>
      length(t.route) <= maximumCarrierLength(input, t.connection_name!) + 1e-7,
  )
  const pairs = pairLengthReports(input, traces),
    coupling = exteriorPairSpacingReports(input, traces)
  return {
    scope: "Completed native DQS1 pair only; BYTE1 and full SBC incomplete",
    connected,
    drc,
    withinLimits,
    pairs,
    coupling,
    valid:
      connected &&
      drc.valid &&
      withinLimits &&
      pairs.every((p) => p.matched) &&
      coupling.every((p) => p.matched),
  }
}
