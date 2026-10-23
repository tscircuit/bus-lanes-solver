import { reuseNativeSurfacePair } from "./reuse-native-surface-pair"
import { surfaceRepairKey } from "./surface-repair-key"
import {
  planOrdinaryRepairCandidates,
  ordinaryRepairBlocksPeer,
} from "./plan-ordinary-repair-candidates"
import { routeAlternateSignalDogbones } from "./alternate-signal-dogbones"
import { NATIVE_PAIR_REPAIR_STEPS } from "./plan-native-pair-seed"
import {
  pairHasUnroutedNativePads,
  routeCoupledPair,
} from "./coupled-pair-routing"
import { generatedEscapeHolesConflict } from "./expanded-signal-sites"
import { signalLayers, type FlexibleSignalState } from "./flexible-signal-state"
import { length } from "./geometry"
import { negotiateSignalSites } from "./negotiate-signal-sites"
import { ownedSignalEscapes, signalDogboneOptions } from "./repair-bus-dogbones"
import { maximumCarrierLength } from "./route-lengths"
import { runBoundedRouting } from "./run-bounded-routing"
import type { SimpleRouteJson, Trace } from "./types"
import { fixedCopper } from "./vector-scene"

/** Recompute solver-owned pair escapes in board-world XY mm (+X right, +Y up).
 * A counterfactual ordinary candidate identifies which pair blocks its package
 * access. Reserve that computed copper while trying native surface terminals
 * and fresh dogbones on allowed carrier planes. Supplied copper stays fixed. */
export function* repairSurfacePairEscape(
  state: FlexibleSignalState,
  blocked: string,
  excluded: ReadonlySet<string>,
): Generator<void, FlexibleSignalState | null> {
  for (const pair of state.native.differentialPairs ?? []) {
    const names = new Set(pair.connectionNames)
    const retained = state.retained.filter(
      (trace) => !names.has(trace.connection_name!),
    )
    const escapes = state.escapes.filter(
      (trace) =>
        !names.has(trace.connection_name!) && trace.connection_name !== blocked,
    )
    const released: FlexibleSignalState = {
      ...state,
      retained,
      escapes,
      traces: state.traces.filter((trace) => trace.connection_name !== blocked),
    }
    const nativeRepair =
      !!state.native.traces?.length &&
      pairHasUnroutedNativePads(state.native, pair)
    let candidates: FlexibleSignalState[]
    if (nativeRepair)
      candidates = yield* planOrdinaryRepairCandidates(released, blocked)
    else {
      const legacy = yield* runBoundedRouting(
        negotiateSignalSites(released, new Set([blocked]), false, false, {
          allowExpandedSites: true,
          expandEmptyDomainsOnly: true,
          maxCandidateSearchNodes: 12000,
        }),
        12000,
      )

      candidates = legacy ? [legacy] : []
    }
    const peerChecks = new Map<FlexibleSignalState, boolean>()
    function* blocksPeer(
      ordinary: FlexibleSignalState,
    ): Generator<void, boolean> {
      if (!nativeRepair) return false
      if (!peerChecks.has(ordinary))
        peerChecks.set(
          ordinary,
          yield* ordinaryRepairBlocksPeer(released, ordinary, blocked),
        )
      return peerChecks.get(ordinary)!
    }
    // Test every compatible ordinary prefix with the current pair before
    // spending a fresh pair-search budget on any one reservation.
    if (nativeRepair)
      for (const ordinary of candidates) {
        const candidate: FlexibleSignalState = {
          ...state,
          retained: [
            ...retained,
            ...state.retained.filter((trace) =>
              names.has(trace.connection_name!),
            ),
          ],
          traces: [...released.traces, ...ordinary.traces],
          escapes: [
            ...escapes,
            ...state.escapes.filter((trace) =>
              names.has(trace.connection_name!),
            ),
            ...ordinary.escapes.filter(
              (trace) => trace.connection_name === blocked,
            ),
          ],
        }
        if (excluded.has(surfaceRepairKey(candidate))) continue
        if (yield* blocksPeer(ordinary)) continue
        if (reuseNativeSurfacePair(state.native, pair, candidate))
          return candidate
        yield
      }
    for (const ordinary of candidates) {
      if (yield* blocksPeer(ordinary)) continue
      const ordinaryEscapes = ordinary.escapes.filter(
        (trace) => trace.connection_name === blocked,
      )
      const members = state.native.connections.filter((connection) =>
        names.has(connection.name),
      )
      const layers = signalLayers(state.native, members[0]).filter((layer) =>
        members.every((member) =>
          signalLayers(state.native, member).includes(layer),
        ),
      )
      const held = [
        ...(state.native.traces ?? []),
        ...escapes,
        ...retained,
        ...released.traces,
        ...ordinaryEscapes,
        ...ordinary.traces,
      ]
      for (const layer of layers) {
        const surface = members.every((connection) =>
          connection.pointsToConnect.every((point) => point.layer === layer),
        )
        for (let quadrant = 0; quadrant < (surface ? 1 : 4); quadrant++) {
          let connections = members,
            pairEscapes: Trace[] = []
          if (!surface) {
            const local = {
              ...state.native,
              connections: members,
              traces: held,
            }
            try {
              const generated = routeAlternateSignalDogbones(
                local,
                signalDogboneOptions(
                  local,
                  new Map(members.map((member) => [member.name, layer])),
                ),
                quadrant,
              )
              connections =
                generated.connections as SimpleRouteJson["connections"]
              pairEscapes = ownedSignalEscapes(state.native, generated.traces)
              if (
                generatedEscapeHolesConflict(state.native, pairEscapes, held) ||
                pairEscapes.some((escape, index) =>
                  generatedEscapeHolesConflict(
                    state.native,
                    [escape],
                    pairEscapes.slice(index + 1),
                  ),
                )
              )
                continue
            } catch {
              yield
              continue
            }
          }
          const local: SimpleRouteJson = {
            ...state.native,
            connections: state.native.connections.map(
              (connection) =>
                connections.find((member) => member.name === connection.name) ??
                connection,
            ),
            traces: [...held, ...pairEscapes],
          }
          const fixed = fixedCopper(local)
          for (const variant of [0, 1, 2, 3]) {
            const paired = yield* runBoundedRouting(
              routeCoupledPair(local, pair, fixed, {
                copper: [],
                penalty: 0,
                variant,
                preferPackageOnlyTuning: true,
              }),
              surface &&
                state.native.traces?.length &&
                pairHasUnroutedNativePads(state.native, pair)
                ? NATIVE_PAIR_REPAIR_STEPS
                : 6000,
            )
            if (
              !paired ||
              paired.some(
                (trace) =>
                  length(trace.route) >
                  maximumCarrierLength(local, trace.connection_name!) + 1e-7,
              )
            )
              continue
            const candidate: FlexibleSignalState = {
              ...state,
              retained: [...retained, ...paired],
              traces: [...released.traces, ...ordinary.traces],
              escapes: [...escapes, ...pairEscapes, ...ordinaryEscapes],
            }
            if (excluded.has(surfaceRepairKey(candidate))) continue
            return candidate
          }
        }
      }
    }
  }
  return null
}
