import {
  PendingPadEscapeCheck,
  pendingPointIsOutsidePackage,
  pendingTerminalPackageFrame,
  type PendingPadEscape,
} from "./pending-pad-escape"
import { PendingPadGeometry } from "./pending-pad-geometry"
import { PendingCopperOwnership } from "./pending-copper-ownership"
import { PendingPeerAccess, type PendingPeerLink } from "./pending-peer-access"
import { signalWidth } from "./repair-bus-dogbones"
import { effectiveCarrierLayers } from "./effective-carrier-layers"
import { validatePendingRoutingAccess } from "./validate-pending-routing-access"
import { PendingAccessSearchUnknownError } from "./pending-access-search-unknown"
import type {
  Connection,
  PendingRoutingAccess,
  PendingRoutingAccessReport,
  SimpleRouteJson,
  Trace,
} from "./types"

interface PendingTerminal {
  input: SimpleRouteJson
  connection: Connection
  terminalIndex: number
  baseline?: PendingPadEscape | null
  witnesses: PendingPadEscape[]
  obligation: PendingTerminalObligation
  suppressed?: boolean
}

interface PendingPeer {
  input: SimpleRouteJson
  connection: Connection
  access: PendingPeerAccess
  phaseIndex: number
  obligations: Map<PendingPeerLink, PendingPeerObligation>
  internalTerminals?: PendingTerminal[]
  internalActive?: boolean
}

interface PendingTerminalObligation {
  readonly kind: "terminal"
  readonly connection: Connection
  readonly phaseIndex: number
  readonly terminalIndex: number
}

interface PendingPeerObligation {
  readonly kind: "peer"
  readonly connection: Connection
  readonly phaseIndex: number
  readonly link: PendingPeerLink
}

/** Stable physical obligations, independent of the currently failed witness.
 * One connection may have several independently blocked native terminals or
 * baseline peer links, including repeated declarations in future phases. */
export type PendingAccessObligation =
  | PendingTerminalObligation
  | PendingPeerObligation

type CandidateCopperKey = string

interface ChangedInputView {
  input: SimpleRouteJson
  active: boolean
}

interface ChangedInputLease {
  input: SimpleRouteJson
  geometry?: PendingPadGeometry
  release(): void
}

interface PendingAccessQueryScope {
  /** Relational unchanged-prefix answers do not supply final certificates. */
  requireCertificates?: boolean
  connection?: Connection
  connections?: ReadonlySet<Connection>
  /** An existential query may reject on one uncertified obligation. A successful
   * empty answer still requires every requested obligation to be checked. */
  stopAfterFirst?: boolean
  obligation?: PendingAccessObligation
  excludedObligations?: ReadonlySet<PendingAccessObligation>
}

/** Preserve demonstrated access for declared future work. Positive witnesses
 * are cheap to revalidate, while blocked witnesses are searched again against
 * the union of candidate copper. Nothing here is inserted into output traces. */
export class PendingPadAccess {
  private uncertifiedSearches = 0
  private readonly terminals: PendingTerminal[]
  private readonly declaredConnections: ReadonlySet<Connection>
  private readonly peers: PendingPeer[] = []
  private readonly results = new Map<
    CandidateCopperKey,
    PendingAccessObligation[]
  >()
  private readonly declaredObligations = new Set<PendingAccessObligation>()
  private readonly changedViews = new Map<SimpleRouteJson, ChangedInputView[]>()
  private readonly baselineGeometry = new Map<
    SimpleRouteJson,
    PendingPadGeometry
  >()
  private ownership?: PendingCopperOwnership

  constructor(private readonly input: SimpleRouteJson) {
    validatePendingRoutingAccess(input)
    this.declaredConnections = new Set(
      (input.pendingRoutingAccess ?? []).flatMap(
        (intent) => intent.connections,
      ),
    )
    this.terminals = (input.pendingRoutingAccess ?? []).flatMap(
      (intent, phaseIndex) => {
        const future = this.futureInput(intent)
        return intent.connections.flatMap((connection) => {
          let geometry = this.baselineGeometry.get(future)
          if (!geometry) {
            this.ownership ??= new PendingCopperOwnership(input)
            geometry = new PendingPadGeometry(future, this.ownership)
            this.baselineGeometry.set(future, geometry)
          }
          const frames = connection.pointsToConnect.map((_, terminalIndex) =>
            pendingTerminalPackageFrame(
              {
                input: future,
                connection,
                terminalIndex,
              },
              geometry,
            ),
          )
          if (frames.some((frame) => !frame))
            this.peers.push({
              input: future,
              connection,
              access: new PendingPeerAccess(future, {
                connection,
                ownership: geometry.ownership,
              }),
              phaseIndex,
              obligations: new Map(),
            })
          const terminals: PendingTerminal[] =
            connection.pointsToConnect.flatMap((_, terminalIndex) => {
              if (!frames[terminalIndex]) return []
              const obligation: PendingTerminalObligation = Object.freeze({
                kind: "terminal",
                connection,
                phaseIndex,
                terminalIndex,
              })
              this.declaredObligations.add(obligation)
              return [
                {
                  input: future,
                  connection,
                  terminalIndex,
                  witnesses: [],
                  obligation,
                },
              ]
            })
          // An internal connection may be completed without leaving its package.
          // Use the same width-expanded field as the native escape predicate.
          // The alternate criterion is activated only by a complete positive
          // original carrier certificate, never an empty/disconnected forest.
          const carriers = effectiveCarrierLayers(future, connection)
          // A forbidden native layer already needs a manufactured/owned carrier
          // handoff, which the framed predicate permits inside the field. Only
          // native carrier layers can introduce the extra field-exit demand.
          // Explicit multilayer terminals use their entire native layer set.
          const hasNativeCarrier = connection.pointsToConnect.some((terminal) =>
            (terminal.layers ?? [terminal.layer]).some((layer) =>
              carriers.includes(layer),
            ),
          )
          const internal =
            hasNativeCarrier &&
            connection.pointsToConnect.length >= 2 &&
            frames.every(
              (frame) =>
                frame &&
                connection.pointsToConnect.every(
                  (point) =>
                    !pendingPointIsOutsidePackage({
                      point,
                      frame,
                      marginMm: signalWidth(future, connection) / 2,
                    }),
                ),
            )
          if (internal)
            this.peers.push({
              input: future,
              connection,
              phaseIndex,
              access: PendingPeerAccess.forInternalPackage(future, {
                connection,
                ownership: geometry.ownership,
              }),
              obligations: new Map(),
              internalTerminals: terminals,
            })
          return terminals
        })
      },
    )
  }

  private *resolveInternalPeers(
    requestedConnection: (connection: Connection) => boolean,
  ): Generator<void> {
    for (const peer of this.peers) {
      if (!peer.internalTerminals || peer.internalActive !== undefined) continue
      if (!requestedConnection(peer.connection)) continue
      const links = yield* peer.access.getBaselineLinks()
      // A cancelled or unknown search cannot publish an activation decision.
      peer.internalActive =
        links.length === peer.connection.pointsToConnect.length - 1
      if (peer.internalActive)
        for (const terminal of peer.internalTerminals)
          terminal.suppressed = true
    }
  }

  private futureInput(intent: PendingRoutingAccess): SimpleRouteJson {
    return {
      ...intent,
      layerCount: this.input.layerCount,
      obstacles: this.input.obstacles,
      traces: this.input.traces,
      differentialPairs: undefined,
      pendingRoutingAccess: undefined,
    }
  }

  getConnectionOwners(connection: Connection): ReadonlySet<string> {
    if (!this.declaredConnections.has(connection) || !this.ownership)
      throw Error(
        "Pending ownership query must reference a declared future connection",
      )
    return this.ownership.owners(connection)
  }

  /** Uncertified repair demands are not continuous impossibility proofs. */
  noSolution(): null {
    if (this.uncertifiedSearches) throw new PendingAccessSearchUnknownError()
    return null
  }

  get unknownCount(): number {
    return this.uncertifiedSearches
  }

  private leaseChangedInput({
    future,
    traces,
  }: {
    future: SimpleRouteJson
    traces: Trace[]
  }): ChangedInputLease {
    let pool = this.changedViews.get(future)
    if (!pool) {
      pool = []
      this.changedViews.set(future, pool)
    }
    let view = pool.find((candidate) => !candidate.active)
    if (!view) {
      view = { input: { ...future }, active: false }
      pool.push(view)
    }
    view.active = true
    view.input.traces = [...(future.traces ?? []), ...traces]
    let active = true
    return {
      input: view.input,
      release: () => {
        if (!active) return
        active = false
        view.active = false
        view.input.traces = future.traces
        // One idle request is enough for sequential checks. Concurrent checks
        // lease distinct views; their surplus caches are not retained forever.
        if (pool.some((other) => other !== view && !other.active))
          pool.splice(pool.indexOf(view), 1)
      },
    }
  }

  *getBlockedConnections(
    additionalTraces: readonly Trace[],
    scope?: PendingAccessQueryScope,
  ): Generator<void, Connection[]> {
    const uncertified = yield* this.getUncertifiedConnections(
      additionalTraces,
      scope,
    )
    if (uncertified.length) throw new PendingAccessSearchUnknownError()
    return []
  }

  /** Conservative repair demands, not continuous negative certificates.
   * Search may try other candidates; final evidence must be positive. */
  *getUncertifiedConnections(
    additionalTraces: readonly Trace[],
    scope?: PendingAccessQueryScope,
  ): Generator<void, Connection[]> {
    const blocked = yield* this.getBlockedObligations(additionalTraces, scope)
    return [...new Set(blocked.map((obligation) => obligation.connection))]
  }

  *getBlockedObligations(
    additionalTraces: readonly Trace[],
    scope?: PendingAccessQueryScope,
  ): Generator<void, PendingAccessObligation[]> {
    const target = scope?.connection
    const requestedConnections =
      scope?.connections && new Set(scope.connections)
    const stopAfterFirst = scope?.stopAfterFirst === true
    const requireCertificates = scope?.requireCertificates === true
    const targetObligation = scope?.obligation
    const excludedObligations =
      scope?.excludedObligations && new Set(scope.excludedObligations)
    if (target && !this.declaredConnections.has(target))
      throw Error("Pending access query must reference a declared connection")
    for (const connection of requestedConnections ?? [])
      if (!this.declaredConnections.has(connection))
        throw Error("Pending access query must reference declared connections")
    for (const obligation of [
      ...(targetObligation ? [targetObligation] : []),
      ...(excludedObligations ?? []),
    ])
      if (!this.declaredObligations.has(obligation))
        throw Error(
          "Pending access query must reference declared physical obligations",
        )
    const requestedConnection = (connection: Connection) =>
      (!target || connection === target) &&
      (!requestedConnections || requestedConnections.has(connection))
    const requested = (obligation: PendingAccessObligation) =>
      requestedConnection(obligation.connection) &&
      (!targetObligation || obligation === targetObligation) &&
      !excludedObligations?.has(obligation)
    if (!this.terminals.length && !this.peers.length) return []
    const newTraces = additionalTraces.filter((trace) => {
      const fixed = this.input.traces?.find(
        (old) => old.pcb_trace_id === trace.pcb_trace_id,
      )
      if (!fixed) return true
      if (JSON.stringify(fixed) !== JSON.stringify(trace))
        throw Error("Pending access cannot replace supplied copper")
      return false
    })
    // Matching and compaction may mutate a route in place. Identity alone
    // cannot establish that a previously accepted physical scene is unchanged.
    const key = JSON.stringify(newTraces)
    const cached = this.results.get(key)
    if (cached) {
      const answer = cached.filter(requested)
      return stopAfterFirst ? answer.slice(0, 1) : answer
    }
    // Cache buckets retain point references. Snapshot mutable candidate routes
    // before any yield, so a reused request's old content keys stay coherent.
    const snapshot = structuredClone(newTraces)
    yield* this.resolveInternalPeers(requestedConnection)
    const blocked = new Set<PendingAccessObligation>()
    // All terminals in one future request see the same physical scene. Keep
    // its identity stable during this union check so request-local raster and
    // scratch caches can be reused across terminals, layers and owners.
    const changedInputs = new Map<SimpleRouteJson, ChangedInputLease>()
    const changedInput = (future: SimpleRouteJson) => {
      let lease = changedInputs.get(future)
      if (!lease) {
        lease = this.leaseChangedInput({ future, traces: snapshot })
        changedInputs.set(future, lease)
      }
      return lease
    }
    try {
      for (const terminal of this.terminals) {
        if (terminal.suppressed) continue
        if (!requested(terminal.obligation)) continue
        const request = {
          input: terminal.input,
          connection: terminal.connection,
          terminalIndex: terminal.terminalIndex,
        }
        if (terminal.baseline === undefined) {
          let geometry = this.baselineGeometry.get(terminal.input)
          if (!geometry) {
            geometry = new PendingPadGeometry(terminal.input, this.ownership)
            this.baselineGeometry.set(terminal.input, geometry)
          }
          terminal.baseline = yield* new PendingPadEscapeCheck(
            request,
            geometry,
          ).findEscape()
          if (terminal.baseline) terminal.witnesses.push(terminal.baseline)
          else this.uncertifiedSearches++
        }
        // Exact unchanged copper preserves a relation without certifying that
        // access exists. Final evidence cannot use this unchanged exception.
        if (!newTraces.length && !requireCertificates) continue
        if (!newTraces.length && terminal.baseline) continue
        if (!newTraces.length) {
          blocked.add(terminal.obligation)
          if (stopAfterFirst) return [terminal.obligation]
          continue
        }
        const lease = changedInput(terminal.input)
        lease.geometry ??= new PendingPadGeometry(
          lease.input,
          this.baselineGeometry.get(terminal.input)!.ownership,
        )
        const check = new PendingPadEscapeCheck(
          { ...request, input: lease.input },
          lease.geometry,
        )
        if (terminal.witnesses.some((escape) => check.isClear(escape))) continue
        const escape = yield* check.findEscape()
        if (escape) {
          terminal.witnesses.push(escape)
          if (terminal.witnesses.length > 8) terminal.witnesses.shift()
        } else {
          this.uncertifiedSearches++
          blocked.add(terminal.obligation)
          if (stopAfterFirst) return [terminal.obligation]
        }
        yield
      }
      for (const peer of this.peers) {
        if (peer.internalTerminals && !peer.internalActive) continue
        if (!requestedConnection(peer.connection)) continue
        if (
          targetObligation &&
          (targetObligation.kind !== "peer" ||
            targetObligation.connection !== peer.connection ||
            targetObligation.phaseIndex !== peer.phaseIndex)
        )
          continue
        if (!newTraces.length && !requireCertificates) continue
        const links = yield* peer.access.getRequiredLinks()
        const selected = new Set<PendingPeerLink>()
        for (const link of links) {
          let obligation = peer.obligations.get(link)
          if (!obligation) {
            obligation = Object.freeze({
              kind: "peer",
              connection: peer.connection,
              phaseIndex: peer.phaseIndex,
              link,
            })
            peer.obligations.set(link, obligation)
            this.declaredObligations.add(obligation)
          }
          if (requested(obligation)) selected.add(link)
        }
        if (!selected.size) continue
        const { input } = changedInput(peer.input)
        const blockedLinks = yield* peer.access.getBlockedLinks(input, {
          links: selected,
          stopAfterFirst,
          requireCertificates,
        })
        for (const link of blockedLinks) {
          this.uncertifiedSearches++
          const obligation = peer.obligations.get(link)!
          blocked.add(obligation)
          if (stopAfterFirst) return [obligation]
        }
        yield
      }
      const answer = [...blocked]
      // Bound retained serialized geometry; large scenes still get the complete
      // witness check instead of an approximate or identity-based cache key.
      // Filtered and first-blocker answers do not enumerate the full result
      // set. They must never populate its cache or bypass global acceptance.
      if (
        !answer.length &&
        newTraces.length &&
        !target &&
        !requestedConnections &&
        !targetObligation &&
        !excludedObligations &&
        !stopAfterFirst &&
        key.length <= 262144
      ) {
        if (this.results.size >= 8)
          this.results.delete(this.results.keys().next().value!)
        this.results.set(key, answer)
      }
      return answer
    } finally {
      for (const lease of changedInputs.values()) lease.release()
    }
  }

  /** This report is produced by the same full-union check used by acceptance.
   * Partial candidate checks and failed unions never produce preserved evidence.
   */
  *getPreservedReport(
    traces: readonly Trace[],
  ): Generator<void, PendingRoutingAccessReport | undefined> {
    const groups = this.input.pendingRoutingAccess
    if (!groups?.length) return undefined
    const blocked = yield* this.getBlockedObligations(traces, {
      requireCertificates: true,
    })
    if (blocked.length) throw new PendingAccessSearchUnknownError()
    const framedTerminals = this.terminals.filter(
      (terminal) => !terminal.suppressed,
    )
    if (framedTerminals.some((terminal) => terminal.baseline === undefined))
      throw Error("Pending terminal baseline validation is incomplete")
    const connections = groups.flatMap((group) => group.connections)
    const traceIds = new Set([
      ...(this.input.traces ?? []).map((trace) => trace.pcb_trace_id),
      ...traces.map((trace) => trace.pcb_trace_id),
    ])
    return {
      outcome: "preserved",
      declaredConnectionCount: connections.length,
      declaredTerminalCount: connections.reduce(
        (sum, connection) => sum + connection.pointsToConnect.length,
        0,
      ),
      framedTerminalCount: framedTerminals.length,
      baselineAccessibleFramedTerminalCount: framedTerminals.filter(
        (terminal) => terminal.baseline !== null,
      ).length,
      // The finite search supplies no certified continuous negative proof.
      baselineInaccessibleFramedTerminalCount: 0,
      ...(framedTerminals.some((terminal) => terminal.baseline === null)
        ? {
            baselineUnresolvedFramedTerminalCount: framedTerminals.filter(
              (terminal) => terminal.baseline === null,
            ).length,
          }
        : {}),
      peerConnectionCount: this.peers.filter(
        (peer) => !peer.internalTerminals || peer.internalActive,
      ).length,
      validatedTraceCount: traceIds.size,
      newlyBlockedConnectionNames: [],
    }
  }
}
