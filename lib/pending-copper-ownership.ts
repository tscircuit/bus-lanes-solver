import type { Connection, Obstacle, SimpleRouteJson } from "./types"

/** Explicit electrical identities from one immutable request. Package IDs and
 * geometry never establish equivalence. Physical contact remains a separate
 * requirement when an owned conductor is used as an access witness. */
export class PendingCopperOwnership {
  private readonly parent = new Map<string, string>()
  private readonly sizes = new Map<string, number>()
  private readonly groups = new Map<string, Set<string>>()
  private readonly cached = new WeakMap<Connection, ReadonlySet<string>>()
  private readonly obstacles: readonly Obstacle[]

  constructor(input: SimpleRouteJson) {
    this.obstacles = input.obstacles
    for (const obstacle of input.obstacles) this.connect(obstacle.connectedTo)
    for (const connection of [
      ...input.connections,
      ...(input.pendingRoutingAccess ?? []).flatMap(
        (phase) => phase.connections,
      ),
    ])
      this.connect(this.seeds(connection))
    for (const owner of this.parent.keys()) {
      const root = this.root(owner)
      const group = this.groups.get(root) ?? new Set<string>()
      group.add(owner)
      this.groups.set(root, group)
    }
  }

  /** A prepared identity may be shared by private future-phase views only
   * while their original obstacle/declaration metadata remains immutable. */
  assertMatches(input: SimpleRouteJson): void {
    if (input.obstacles !== this.obstacles)
      throw Error("Pending ownership belongs to another obstacle declaration")
  }

  private seeds(connection: Connection): string[] {
    return [
      connection.name,
      connection.source_trace_id,
      connection.netConnectionName,
      connection.rootConnectionName,
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ].filter(
      (owner): owner is string => typeof owner === "string" && owner.length > 0,
    )
  }

  private root(owner: string): string {
    let result = owner
    while (this.parent.get(result) !== result) result = this.parent.get(result)!
    while (owner !== result) {
      const next = this.parent.get(owner)!
      this.parent.set(owner, result)
      owner = next
    }
    return result
  }

  private connect(identities: readonly string[]): void {
    const owners = identities.filter(
      (owner) => typeof owner === "string" && owner.length > 0,
    )
    for (const owner of owners)
      if (!this.parent.has(owner)) {
        this.parent.set(owner, owner)
        this.sizes.set(owner, 1)
      }
    if (!owners.length) return
    for (const owner of owners.slice(1)) {
      let first = this.root(owners[0]),
        second = this.root(owner)
      if (first === second) continue
      if (this.sizes.get(first)! < this.sizes.get(second)!)
        [first, second] = [second, first]
      this.parent.set(second, first)
      this.sizes.set(first, this.sizes.get(first)! + this.sizes.get(second)!)
    }
  }

  owners(connection: Connection): ReadonlySet<string> {
    const cached = this.cached.get(connection)
    if (cached) return cached
    const seeds = this.seeds(connection)
    let prepared: ReadonlySet<string> | undefined
    let onePreparedClass = seeds.length > 0
    for (const owner of seeds) {
      if (!this.parent.has(owner)) {
        onePreparedClass = false
        break
      }
      const group = this.groups.get(this.root(owner))!
      if (prepared && prepared !== group) {
        onePreparedClass = false
        break
      }
      prepared = group
    }
    // Original declarations and their layer/reverse views share one class.
    // Keep one set for that net, rather than N copies of N section aliases.
    if (onePreparedClass && prepared) return prepared
    const result = new Set<string>()
    for (const owner of seeds) {
      result.add(owner)
      if (this.parent.has(owner))
        for (const alias of this.groups.get(this.root(owner)) ?? [])
          result.add(alias)
    }
    this.cached.set(connection, result)
    return result
  }
}
