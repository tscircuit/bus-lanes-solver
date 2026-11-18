import { joinSignalEscapes } from "./join-signal-escapes"
import type { SurfaceBridgeRoute } from "./route-surface-bridge"
import {
  RoutingMemoryBudget,
  RoutingMemoryBudgetExceeded,
  PendingRoutingWorkBudgetExceeded,
} from "./routing-memory-budget"
import type { SimpleRouteJson, Terminal } from "./types"
import { PendingAccessSearchUnknownError } from "./pending-access-search-unknown"

export interface PendingSurfacePass {
  remaining: number
  requiredVias?: number
}

interface RejectedSurfaceRoute {
  terminals: Terminal[]
  bytes: number
  uncertified?: boolean
}

/** Bounded guidance for one immutable native candidate query. Accounting cuts
 * are board-world points in mm (+X right, +Y up), never reserved future copper.
 * Every alternative still goes through the caller's full physical predicate. */
export class PendingSurfaceSearch {
  readonly maximumExpansions: number
  remaining: number
  private budget?: RoutingMemoryBudget
  private readonly input: SimpleRouteJson
  private readonly viaCounts: readonly number[]
  private readonly activeCuts = new Set<string>()
  private readonly rejected = new Map<string, RejectedSurfaceRoute>()
  private memoBytes = 0
  private cutBytes = 0
  private readonly headerBytes = 512
  private lastUnknown?: Error
  private accessUnknown?: PendingAccessSearchUnknownError

  constructor({
    input,
    maximumExpansions,
    viaCounts,
  }: {
    input: SimpleRouteJson
    maximumExpansions: number
    viaCounts: readonly number[]
  }) {
    this.input = input
    this.maximumExpansions = maximumExpansions
    this.remaining = maximumExpansions
    this.viaCounts = viaCounts
  }

  get memory(): RoutingMemoryBudget | undefined {
    return this.budget
  }

  attachMemory(maximumBytes: number): RoutingMemoryBudget {
    if (this.budget) return this.budget
    const memory = new RoutingMemoryBudget(maximumBytes)
    if (!memory.reserve(this.headerBytes))
      throw new RoutingMemoryBudgetExceeded()
    this.budget = memory
    return memory
  }

  /** The ordinary scalar frontier runs until its first rejected physical goal;
   * accepted ordinary routes are never preempted by a diversity quota. */
  initialPass(): PendingSurfacePass {
    return { remaining: this.remaining }
  }

  /** After a rejected goal, cover every permitted transition count, trying
   * other counts before returning to that goal's count. Unused work is retained.
   * This is bounded guidance, not a proof of search completeness. */
  *passes(rejectedViaCount: number): Generator<PendingSurfacePass> {
    const domains = [
      ...this.viaCounts.filter((count) => count !== rejectedViaCount),
      ...this.viaCounts.filter((count) => count === rejectedViaCount),
    ]
    for (const [index, requiredVias] of domains.entries()) {
      if (!this.remaining) break
      yield {
        requiredVias,
        remaining: Math.ceil(this.remaining / (domains.length - index)),
      }
    }
  }

  expand(pass: PendingSurfacePass): void {
    if (!this.remaining || !pass.remaining)
      throw new PendingRoutingWorkBudgetExceeded()
    this.remaining--
    pass.remaining--
  }

  unknown(error: Error): void {
    this.lastUnknown = error
  }

  uncertified(): void {
    this.accessUnknown ??= new PendingAccessSearchUnknownError()
    this.lastUnknown = this.accessUnknown
  }

  noSolution(): null {
    if (this.lastUnknown) throw this.lastUnknown
    if (!this.remaining) throw new PendingRoutingWorkBudgetExceeded()
    return null
  }

  accountingInput(): SimpleRouteJson {
    return {
      ...this.input,
      pendingRoutingAccess: this.input.pendingRoutingAccess?.map((group) => ({
        ...group,
        connections: group.connections.flatMap((connection) => {
          const pointsToConnect = connection.pointsToConnect.flatMap(
            (point) => {
              const layers = (point.layers ?? [point.layer]).filter((layer) =>
                this.activeCuts.has(this.cutKey(point, layer)),
              )
              return layers.length
                ? [{ ...point, layer: layers[0], layers }]
                : []
            },
          )
          return pointsToConnect.length
            ? [{ ...connection, pointsToConnect }]
            : []
        }),
      })),
    }
  }

  private cutKey(terminal: { x: number; y: number }, layer: string): string {
    return `${terminal.x},${terminal.y},${layer}`
  }

  activate(terminals: readonly Terminal[]): boolean {
    if (!this.memory) throw new RoutingMemoryBudgetExceeded()
    // No eager all-terminal index is allocated. Reserve temporary staging
    // before collecting changes, and publish no cut if either charge fails.
    const layers = terminals.reduce(
      (sum, terminal) => sum + (terminal.layers?.length ?? 1),
      0,
    )
    const scratchBytes = layers * 512
    if (!this.memory.reserve(scratchBytes))
      throw new RoutingMemoryBudgetExceeded()
    try {
      const additions = new Set<string>()
      for (const terminal of terminals)
        for (const layer of terminal.layers ?? [terminal.layer]) {
          const key = this.cutKey(terminal, layer)
          const declared = this.input.pendingRoutingAccess?.some((group) =>
            group.connections.some((connection) =>
              connection.pointsToConnect.some(
                (point) =>
                  point.x === terminal.x &&
                  point.y === terminal.y &&
                  (point.layers
                    ? point.layers.includes(layer)
                    : point.layer === layer),
              ),
            ),
          )
          if (declared && !this.activeCuts.has(key)) additions.add(key)
        }
      let bytes = 0
      for (const key of additions) bytes += 256 + key.length * 2
      if (!this.memory.reserve(bytes)) throw new RoutingMemoryBudgetExceeded()
      this.cutBytes += bytes
      for (const key of additions) this.activeCuts.add(key)
      return additions.size > 0
    } finally {
      this.memory.release(scratchBytes)
    }
  }

  /** IDs are allocation details; route ownership and every physical field,
   * including taper/curve/coupled metadata, belong to this immutable query key. */
  routeKey(route: SurfaceBridgeRoute): string {
    const joined = joinSignalEscapes(route.carrier, route.escapes)
    return JSON.stringify({
      connection: joined.connection_name,
      source: joined.source_trace_id,
      route: joined.route,
      curvedSegments: joined.curvedSegments,
      coupledSection: joined.coupledSection,
    })
  }

  rejection(key: string): readonly Terminal[] | undefined {
    return this.rejected.get(key)?.terminals
  }

  rejectionWasUncertified(key: string): boolean {
    return this.rejected.get(key)?.uncertified === true
  }

  reject(
    key: string,
    result:
      | readonly Terminal[]
      | { terminals: readonly Terminal[]; uncertified: boolean },
  ): void {
    const terminals = "terminals" in result ? result.terminals : result
    const uncertified = "terminals" in result && result.uncertified
    if (!this.memory || this.rejected.has(key)) return
    const bytes = 128 + key.length * 2 + terminals.length * 192
    const limit = Math.min(1024 * 1024, Math.floor(this.memory.maxBytes / 8))
    if (bytes > limit) return
    while (this.memoBytes + bytes > limit && this.rejected.size) {
      const oldest = this.rejected.keys().next().value!
      const entry = this.rejected.get(oldest)!
      this.rejected.delete(oldest)
      this.memoBytes -= entry.bytes
      this.memory.release(entry.bytes)
    }
    // This optional memo must not create an additional resource failure.
    if (bytes > this.memory.maxBytes - this.memory.usedBytes) return
    this.memory.reserve(bytes)
    this.memoBytes += bytes
    this.rejected.set(key, {
      bytes,
      ...(uncertified ? { uncertified: true } : {}),
      terminals: terminals.map((terminal) => ({
        ...terminal,
        layers: terminal.layers?.slice(),
      })),
    })
  }

  releasePassMemory(): void {
    if (this.memory)
      this.memory.release(
        this.memory.usedBytes -
          this.memoBytes -
          this.cutBytes -
          this.headerBytes,
      )
  }

  dispose(): void {
    this.rejected.clear()
    this.activeCuts.clear()
    if (this.memory) this.memory.release(this.memory.usedBytes)
    this.memoBytes = 0
    this.cutBytes = 0
  }
}
