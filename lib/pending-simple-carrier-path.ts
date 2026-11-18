import { RoutingMemoryBudgetExceeded } from "./routing-memory-budget"

export interface PendingCarrierGraphEdge<Step> {
  readonly other: number
  readonly step: Step
}

export interface PendingSimpleCarrierPath<Step> {
  readonly steps: Step[]
}

interface CarrierPathRequest<Step> {
  readonly nodeCount: number
  /** Physically equivalent native anchors of each endpoint. They are
   * contracted so a path cannot touch its endpoint, leave it through another
   * native layer, and count that excursion as carrier participation. */
  readonly sourceNodes: readonly number[]
  readonly targetNodes: readonly number[]
  /** One immutable undirected graph. Reverse edges must describe the same
   * physical connection, and carrier classification must be symmetric. */
  neighbors(node: number): Iterable<PendingCarrierGraphEdge<Step>>
  /** The caller verifies physical width, clearance and carrier policy. Layer
   * presence or a via transition alone must never qualify as a carrier edge. */
  isCarrier(step: Step): boolean
  reverseStep(step: Step): Step
}

interface Scratch {
  readonly terminalMask: Uint8Array
  readonly sourceAliases: Int32Array
  readonly targetAliases: Int32Array
  readonly reached: Uint8Array
  readonly reachQueue: Int32Array
  readonly parent: Int32Array
  readonly queue: Int32Array
  readonly flowTo: Int32Array
  readonly flowFrom: Int32Array
}

const maxWorkBytes = 64 * 1024 * 1024
// A conservative allowance for one live iterator and its wrapper generators.
// DFS retains only numeric cursors, never a generator per active vertex.
const iteratorFrameBytes = 1024

function allocateScratch(request: {
  nodeCount: number
  sourceCapacity: number
  targetCapacity: number
}): Scratch {
  const { nodeCount, sourceCapacity, targetCapacity } = request
  const networkCount = nodeCount * 2 + 2
  // Physical graph nodes have one in/out pair. Two private terminal nodes
  // contract the physically equivalent native-layer anchors of each endpoint.
  const bytes =
    nodeCount *
      (Uint8Array.BYTES_PER_ELEMENT * 2 + Int32Array.BYTES_PER_ELEMENT * 3) +
    networkCount * Int32Array.BYTES_PER_ELEMENT * 2 +
    (sourceCapacity + targetCapacity) * Int32Array.BYTES_PER_ELEMENT +
    iteratorFrameBytes
  if (!Number.isSafeInteger(bytes) || bytes > maxWorkBytes)
    throw new RoutingMemoryBudgetExceeded(
      "Pending carrier path exceeds its 64 MiB work budget",
    )
  try {
    return {
      terminalMask: new Uint8Array(nodeCount),
      sourceAliases: new Int32Array(sourceCapacity),
      targetAliases: new Int32Array(targetCapacity),
      reached: new Uint8Array(nodeCount),
      reachQueue: new Int32Array(nodeCount),
      parent: new Int32Array(networkCount),
      queue: new Int32Array(networkCount),
      flowTo: new Int32Array(nodeCount),
      flowFrom: new Int32Array(nodeCount),
    }
  } catch (error) {
    if (error instanceof RangeError)
      throw new RoutingMemoryBudgetExceeded(
        "Could not allocate pending carrier path work",
      )
    throw error
  }
}

/** Find a graph-simple endpoint path that actually contains a carrier edge.
 * A walk carrying a boolean `visitedCarrier` can leave through a via and
 * return through that same via before reaching its peer: that spur proves
 * nothing about carrier participation.
 *
 * A simple witness from a linear two-state flood can be used immediately. A
 * walk containing a spur instead needs the source-target biconnected chain:
 * select one carrier edge a--b on that chain, remove it, then find two
 * vertex-disjoint arms from {source,target} to {a,b}. Either pairing, joined
 * by a--b, is simple. Only two flow augmentations are needed, once, rather than
 * repeating flow for every carrier edge. This is a private witness on the
 * caller's existing graph, not emitted routing copper or a new route domain.
 *
 * The graph must faithfully represent physical contacts. In particular, an
 * opaque fixed-component shortcut must not itself be marked as a carrier;
 * the caller still owns physical witness and manufactured-via validation. */
export function* findSimpleCarrierPath<Step>({
  nodeCount: physicalCount,
  sourceNodes,
  targetNodes,
  neighbors,
  isCarrier,
  reverseStep,
}: CarrierPathRequest<Step>): Generator<
  void,
  PendingSimpleCarrierPath<Step> | undefined
> {
  if (!Number.isSafeInteger(physicalCount) || physicalCount < 0)
    throw new RangeError(
      "Pending carrier graph needs a nonnegative integer size",
    )
  if (!sourceNodes.length || !targetNodes.length) return undefined
  const source = physicalCount
  const target = physicalCount + 1
  const nodeCount = physicalCount + 2
  const scratch = allocateScratch({
    nodeCount,
    sourceCapacity: Math.min(sourceNodes.length, physicalCount),
    targetCapacity: Math.min(targetNodes.length, physicalCount),
  })
  const {
    terminalMask,
    sourceAliases,
    targetAliases,
    reached,
    reachQueue,
    parent,
    queue,
    flowTo,
    flowFrom,
  } = scratch
  let operations = 0
  let sourceCount = 0
  let targetCount = 0
  const validNode = (node: number) =>
    Number.isInteger(node) && node >= 0 && node < physicalCount
  for (const [nodes, mask] of [
    [sourceNodes, 1],
    [targetNodes, 2],
  ] as const)
    for (const node of nodes) {
      if (!validNode(node))
        throw new RangeError(
          "Pending carrier graph contains an invalid terminal node",
        )
      if (!(terminalMask[node] & mask)) {
        terminalMask[node] |= mask
        if (mask === 1) sourceAliases[sourceCount++] = node
        else targetAliases[targetCount++] = node
      }
      if (++operations % 256 === 0) yield
    }
  if (!sourceCount || !targetCount) return undefined
  for (let index = 0; index < sourceCount; index++) {
    if (terminalMask[sourceAliases[index]] === 3) return undefined
    if (++operations % 256 === 0) yield
  }

  function canonical(node: number): number {
    if (terminalMask[node] & 1) return source
    if (terminalMask[node] & 2) return target
    return node
  }

  function* edgesFrom(request: {
    original: number
    canonical: number
  }): Generator<PendingCarrierGraphEdge<Step>> {
    for (const edge of neighbors(request.original)) {
      if (!validNode(edge.other))
        throw new RangeError(
          "Pending carrier graph contains an invalid neighbor",
        )
      const other = canonical(edge.other)
      // A self-loop or an excursion between aliases of the same endpoint
      // cannot belong to a simple endpoint path.
      if (other !== request.canonical) yield { other, step: edge.step }
    }
  }

  function* graphEdges(node: number): Generator<PendingCarrierGraphEdge<Step>> {
    if (node === source || node === target) {
      const aliases = node === source ? sourceAliases : targetAliases
      const count = node === source ? sourceCount : targetCount
      for (let index = 0; index < count; index++)
        yield* edgesFrom({ original: aliases[index], canonical: node })
      return
    }
    yield* edgesFrom({ original: node, canonical: node })
  }

  /** An augmented flood is a cheap positive proof only when its reconstructed
   * physical-node path is simple. Exhaustion is a valid negative; a spur walk
   * is deliberately inconclusive and proceeds to the block-chain check. */
  function* fastPath(): Generator<
    void,
    PendingSimpleCarrierPath<Step> | null | undefined
  > {
    parent.fill(-1)
    const start = source * 2
    const goal = target * 2 + 1
    parent[start] = start
    queue[0] = start
    let tail = 1
    for (let head = 0; head < tail && parent[goal] < 0; head++) {
      const state = queue[head]
      for (const edge of graphEdges(Math.floor(state / 2))) {
        const next =
          edge.other * 2 + Number(state % 2 === 1 || isCarrier(edge.step))
        if (parent[next] < 0) {
          parent[next] = state
          queue[tail++] = next
        }
        if (++operations % 256 === 0) yield
        if (next === goal) break
      }
    }
    if (parent[goal] < 0) return undefined
    reached.fill(0)
    const steps: Step[] = []
    for (let state = goal; state !== start; state = parent[state]) {
      const node = Math.floor(state / 2)
      if (reached[node]) return null
      reached[node] = 1
      const previous = parent[state]
      const from = Math.floor(previous / 2)
      const carrierRequired = previous % 2 === 0 && state % 2 === 1
      let selected: PendingCarrierGraphEdge<Step> | undefined
      for (const edge of graphEdges(from)) {
        if (++operations % 256 === 0) yield
        if (edge.other === node && (!carrierRequired || isCarrier(edge.step))) {
          selected = edge
          break
        }
      }
      if (!selected) throw Error("Pending carrier flood lost a physical edge")
      steps.push(selected.step)
    }
    if (reached[source]) return null
    steps.reverse()
    return { steps }
  }

  /** Rooted at source, a block popped for a DFS child is on the endpoint
   * block-cut chain exactly when target lies in that child's DFS subtree.
   * Target being the parent does NOT qualify: that is precisely a dead-end
   * carrier spur. One carrier representative per still-open parent block is
   * enough; closed child blocks are discarded, while an unclosed child's
   * representative merges upward. Thus no O(E) edge stack is retained.
   *
   * A per-vertex ordinal cursor recreates the immutable neighbor iterator so
   * deep raster DFS does not retain one generator frame per vertex. This is
   * linear on bounded-degree grids; arbitrary high-degree graph vertices can
   * require sum(degree^2) neighbor examinations. All such work still yields. */
  function* carrierOnBlockChain(): Generator<
    void,
    { from: number; to: number } | undefined
  > {
    const discovered = flowTo
    const low = flowFrom
    const dfsParent = reachQueue
    const stackNodes = parent.subarray(0, nodeCount)
    const cursor = parent.subarray(nodeCount, nodeCount * 2)
    const candidateFrom = queue.subarray(0, nodeCount)
    const candidateTo = queue.subarray(nodeCount, nodeCount * 2)
    const targetBelow = reached
    discovered.fill(0)
    low.fill(0)
    candidateFrom.fill(-1)
    cursor.fill(0)
    targetBelow.fill(0)
    let clock = 1
    discovered[source] = low[source] = clock
    dfsParent[source] = -1
    stackNodes[0] = source
    let depth = 1
    try {
      while (depth) {
        const node = stackNodes[depth - 1]
        let next: PendingCarrierGraphEdge<Step> | undefined
        let ordinal = 0
        for (const edge of graphEdges(node)) {
          if (++operations % 256 === 0) yield
          if (ordinal++ === cursor[node]) {
            cursor[node]++
            next = edge
            break
          }
        }
        if (next === undefined) {
          depth--
          const previous = dfsParent[node]
          if (previous < 0) continue
          low[previous] = Math.min(low[previous], low[node])
          targetBelow[previous] |= targetBelow[node]
          if (low[node] >= discovered[previous]) {
            if (targetBelow[node] && candidateFrom[node] >= 0)
              return { from: candidateFrom[node], to: candidateTo[node] }
          } else if (candidateFrom[node] >= 0) {
            candidateFrom[previous] = candidateFrom[node]
            candidateTo[previous] = candidateTo[node]
          }
          continue
        }
        const edge = next
        const other = edge.other
        if (!discovered[other]) {
          discovered[other] = low[other] = ++clock
          dfsParent[other] = node
          targetBelow[other] = Number(other === target)
          if (isCarrier(edge.step)) {
            candidateFrom[other] = node
            candidateTo[other] = other
          }
          stackNodes[depth++] = other
        } else if (
          other === dfsParent[node] ||
          discovered[other] < discovered[node]
        ) {
          // Parallel parent edges belong to the same two-vertex block and
          // may qualify as carrier even when the DFS tree edge did not.
          if (other !== dfsParent[node])
            low[node] = Math.min(low[node], discovered[other])
          if (isCarrier(edge.step)) {
            candidateFrom[node] = node
            candidateTo[node] = other
          }
        }
      }
      return undefined
    } catch (error) {
      if (error instanceof RangeError)
        throw new RoutingMemoryBudgetExceeded(
          "Could not retain pending carrier block work",
        )
      throw error
    }
  }

  const networkSource = nodeCount * 2
  const networkTarget = networkSource + 1
  let usedSources = 0
  let usedTargets = 0
  let firstEnd = -1
  let secondEnd = -1

  function vertexUsed(node: number): boolean {
    return (
      flowTo[node] >= 0 ||
      flowFrom[node] >= 0 ||
      (node === source && (usedSources & 1) !== 0) ||
      (node === target && (usedSources & 2) !== 0)
    )
  }

  function* residualNeighbors(node: number): Generator<number | undefined> {
    if (node === networkSource) {
      if (!(usedSources & 1)) yield source * 2
      if (!(usedSources & 2)) yield target * 2
      return
    }
    const vertex = Math.floor(node / 2)
    if (node % 2 === 0) {
      if (!vertexUsed(vertex)) yield node + 1
      const previous = flowFrom[vertex]
      if (previous >= 0) yield previous * 2 + 1
      return
    }
    if (vertexUsed(vertex)) yield node - 1
    if (vertex === firstEnd && !(usedTargets & 1)) yield networkTarget
    if (vertex === secondEnd && !(usedTargets & 2)) yield networkTarget
    for (const edge of graphEdges(vertex)) {
      if (++operations % 256 === 0) yield undefined
      if (
        (vertex === firstEnd && edge.other === secondEnd) ||
        (vertex === secondEnd && edge.other === firstEnd) ||
        flowTo[vertex] === edge.other
      )
        continue
      yield edge.other * 2
    }
  }

  function augment(): void {
    // Remove reversed old edges before adding rerouted edges. Applying these
    // in a single pass could clear a new predecessor installed at that vertex.
    for (
      let node = networkTarget;
      node !== networkSource;
      node = parent[node]
    ) {
      const previous = parent[node]
      if (previous === networkSource || node === networkTarget) continue
      if (previous % 2 === 0 && node % 2 === 1) {
        const from = Math.floor(node / 2)
        const to = previous / 2
        if (from !== to) {
          flowTo[from] = -1
          flowFrom[to] = -1
        }
      }
    }
    for (
      let node = networkTarget;
      node !== networkSource;
      node = parent[node]
    ) {
      const previous = parent[node]
      if (previous === networkSource) {
        usedSources |= node === source * 2 ? 1 : 2
      } else if (node === networkTarget) {
        usedTargets |= Math.floor(previous / 2) === firstEnd ? 1 : 2
      } else if (previous % 2 === 1 && node % 2 === 0) {
        const from = Math.floor(previous / 2)
        const to = node / 2
        if (from !== to) {
          flowTo[from] = to
          flowFrom[to] = from
        }
      }
    }
  }

  function* findArms(): Generator<void, boolean> {
    flowTo.fill(-1)
    flowFrom.fill(-1)
    usedSources = 0
    usedTargets = 0
    for (let pass = 0; pass < 2; pass++) {
      parent.fill(-1)
      parent[networkSource] = networkSource
      queue[0] = networkSource
      let tail = 1
      for (let head = 0; head < tail && parent[networkTarget] < 0; head++) {
        const node = queue[head]
        for (const other of residualNeighbors(node)) {
          if (other === undefined) {
            yield
            continue
          }
          if (parent[other] >= 0) continue
          parent[other] = node
          queue[tail++] = other
          if (other === networkTarget) break
        }
        if (++operations % 256 === 0) yield
      }
      if (parent[networkTarget] < 0) return false
      augment()
    }
    return true
  }

  function* arm(
    start: number,
  ): Generator<void, { end: number; steps: Step[] }> {
    const steps: Step[] = []
    let node = start
    for (let count = 0; count < nodeCount; count++) {
      const next = flowTo[node]
      if (next < 0) {
        if (node !== firstEnd && node !== secondEnd)
          throw new Error("Pending carrier path lost a flow endpoint")
        return { end: node, steps }
      }
      let edge: PendingCarrierGraphEdge<Step> | undefined
      for (const candidate of graphEdges(node)) {
        if (++operations % 256 === 0) yield
        if (candidate.other === next) {
          edge = candidate
          break
        }
      }
      if (!edge) throw new Error("Pending carrier path lost a physical edge")
      steps.push(edge.step)
      node = next
      if (++operations % 256 === 0) yield
    }
    throw new Error("Pending carrier path contains a residual cycle")
  }

  const fast = yield* fastPath()
  if (fast !== null) return fast
  const selected = yield* carrierOnBlockChain()
  if (!selected) return undefined
  firstEnd = selected.from
  secondEnd = selected.to
  let carrierStep: Step | undefined
  for (const edge of graphEdges(firstEnd)) {
    if (++operations % 256 === 0) yield
    if (edge.other === secondEnd && isCarrier(edge.step)) {
      carrierStep = edge.step
      break
    }
  }
  if (carrierStep === undefined)
    throw Error("Pending carrier block lost its eligible edge")
  if (!(yield* findArms()))
    throw Error("Pending carrier block lost its simple path")
  const fromSource = yield* arm(source)
  const fromTarget = yield* arm(target)
  if (fromSource.end === fromTarget.end)
    throw new Error("Pending carrier path did not separate its endpoints")
  const carrier =
    fromSource.end === firstEnd ? carrierStep : reverseStep(carrierStep)
  const steps = fromSource.steps
  steps.push(carrier)
  for (let index = fromTarget.steps.length - 1; index >= 0; index--) {
    steps.push(reverseStep(fromTarget.steps[index]))
    if (++operations % 256 === 0) yield
  }
  return { steps }
}
