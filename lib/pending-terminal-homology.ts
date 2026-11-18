import type { Point, SimpleRouteJson } from "./types"
import {
  RoutingMemoryBudgetExceeded,
  type RoutingMemoryBudget,
} from "./routing-memory-budget"

/** Integer crossing signatures enrich path candidates around every declared
 * future native terminal. Rays are accounting cuts, never copper or reserved
 * corridors. Equal signatures do not establish equal finite-width access;
 * the physical union predicate remains the acceptance authority. */
export class PendingTerminalHomology {
  readonly empty = 0
  private readonly terminals: Array<Point & { layer: string }>
  private readonly terminalIndices = new Map<string, number[]>()
  private readonly signatures: Float64Array[]
  private readonly keys: string[]
  private readonly ids: Map<string, number>
  private heldBytes = 0

  constructor(
    input: SimpleRouteJson,
    private readonly memory?: RoutingMemoryBudget,
  ) {
    const terminalCount = (input.pendingRoutingAccess ?? []).reduce(
      (count, group) =>
        count +
        group.connections.reduce(
          (sum, connection) =>
            sum +
            connection.pointsToConnect.reduce(
              (points, point) => points + (point.layers?.length ?? 1),
              0,
            ),
          0,
        ),
      0,
    )
    this.account(256 + terminalCount * 192)
    this.terminals = (input.pendingRoutingAccess ?? []).flatMap((group) =>
      group.connections.flatMap((connection) =>
        connection.pointsToConnect.flatMap((point) =>
          (point.layers ?? [point.layer]).map((layer) => ({ ...point, layer })),
        ),
      ),
    )
    for (let index = 0; index < this.terminals.length; index++) {
      const layer = this.terminals[index].layer
      let indices = this.terminalIndices.get(layer)
      if (!indices) {
        indices = []
        this.terminalIndices.set(layer, indices)
      }
      indices.push(index)
    }
    const zero = new Float64Array(this.terminals.length)
    const key = zero.join(",")
    // Typed vector payload is exact; the conservative allowance includes the
    // map entry, view/string headers, backing-table slack and list references.
    this.account(zero.byteLength + key.length * 2)
    this.signatures = [zero]
    this.keys = [key]
    this.ids = new Map([[this.keys[0], 0]])
  }

  key(signature: number): string {
    return this.keys[signature]
  }

  dispose(): void {
    this.ids.clear()
    this.keys.length = 0
    this.signatures.length = 0
    this.terminals.length = 0
    this.terminalIndices.clear()
    this.memory?.release(this.heldBytes)
    this.heldBytes = 0
  }

  private account(bytes: number): void {
    if (!this.memory) return
    if (!this.memory.reserve(bytes)) throw new RoutingMemoryBudgetExceeded()
    this.heldBytes += bytes
  }

  extend({
    signature,
    layer,
    start,
    end,
  }: {
    signature: number
    layer: string
    start: Point
    end: Point
  }): number {
    let next: Float64Array | undefined
    const indices = this.terminalIndices.get(layer)
    if (!indices) return signature
    for (let at = 0; at < indices.length; at++) {
      const index = indices[at]
      const terminal = this.terminals[index]
      // Half-open Y intervals count a subdivided crossing once and make a
      // tangent vertex cancel. Horizontal collinear edges contribute zero.
      const up = start.y <= terminal.y && end.y > terminal.y
      const down = end.y <= terminal.y && start.y > terminal.y
      if (!up && !down) continue
      const x =
        start.x +
        ((terminal.y - start.y) * (end.x - start.x)) / (end.y - start.y)
      if (x <= terminal.x) continue
      next ??= this.signatures[signature].slice()
      next[index] += up ? 1 : -1
    }
    if (!next) return signature
    const key = next.join(",")
    const old = this.ids.get(key)
    if (old !== undefined) return old
    this.account(256 + next.byteLength + key.length * 2)
    const id = this.signatures.length
    this.ids.set(key, id)
    this.signatures.push(next)
    this.keys.push(key)
    return id
  }
}
