import { distance, length, segmentDistance, simplify } from "./geometry"
import { GridVisibilitySearch, type GridRoutingAccess } from "./grid-visibility"
import { PendingPadScene } from "./pending-pad-escape"
import { PendingPadGeometry } from "./pending-pad-geometry"
import { PendingCopperOwnership } from "./pending-copper-ownership"
import { PendingAccessSearchUnknownError } from "./pending-access-search-unknown"
import { findSimpleCarrierPath } from "./pending-simple-carrier-path"
import type {
  PendingOwnedCarrierAccess,
  OwnedCarrierTarget,
} from "./pending-owned-carrier-access"
import type { Connection, Point, SimpleRouteJson } from "./types"
import { VectorScene, type Copper } from "./vector-scene"

type LayerPointKey = string

// Original phase metadata and copper are immutable. Multiple future peers in
// that phase share one retained trace key, rather than copying the whole SRJ
// or its copper once for every connection.
const originalTraceKeys = new WeakMap<SimpleRouteJson, string>()
function traceUnionKey(input: SimpleRouteJson): string {
  return JSON.stringify(
    (input.traces ?? []).map((trace) => JSON.stringify(trace)).sort(),
  )
}

interface PeerWire {
  kind: "wire"
  layer: string
  path: Point[]
  widthMm: number
  requiresSuppliedCopper?: boolean
}

interface PeerTransition {
  kind: "new_via" | "fixed_via" | "native_transition"
  point: Point
  fromLayer: string
  toLayer: string
  layers: string[]
}

interface PeerFixedComponent {
  kind: "fixed_component"
  from: OwnedCarrierTarget
  to: OwnedCarrierTarget
}

type PeerStep = PeerWire | PeerTransition | PeerFixedComponent

interface FixedViaSpan {
  point: Point
  layers: string[]
}

interface PeerWitness {
  fromIndex: number
  toIndex: number
  steps: PeerStep[]
  existingConnection?: true
}

/** One stable original peer obligation. It may have a positive original
 * witness, or join components whose separation the finite search did not prove.
 * Coordinates and candidate witnesses may change; this obligation does not. */
export interface PendingPeerLink {
  readonly sourceTerminalIndex: number
  readonly targetTerminalIndex: number
}

interface PeerLinkState {
  readonly link: PendingPeerLink
  readonly baselineUnresolved: boolean
  witness?: PeerWitness
}

interface AnchorEdge {
  other: number
  step: PeerStep
}

interface PeerAnchor {
  point: Point
  layer: string
  edges: AnchorEdge[]
  attachments: GridRoutingAccess["starts"]
}

interface GridAttachment {
  anchor: number
  path: Point[]
}

/** An unfinished oracle is not evidence that a future connection is blocked. */
export class PendingPeerAccessUnknownError extends PendingAccessSearchUnknownError {
  constructor(message: string) {
    super(message)
    this.name = "PendingPeerAccessUnknownError"
  }
}

function reverseStep(step: PeerStep): PeerStep {
  if (step.kind === "fixed_component")
    return { ...step, from: step.to, to: step.from }
  return step.kind === "wire"
    ? { ...step, path: step.path.toReversed() }
    : { ...step, fromLayer: step.toLayer, toLayer: step.fromLayer }
}

function snapshotStep(step: PeerStep): PeerStep {
  if (step.kind === "fixed_component")
    return {
      kind: "fixed_component",
      from: { point: { ...step.from.point }, layer: step.from.layer },
      to: { point: { ...step.to.point }, layer: step.to.layer },
    }
  return step.kind === "wire"
    ? { ...step, path: step.path.map(({ x, y }) => ({ x, y })) }
    : {
        ...step,
        point: { x: step.point.x, y: step.point.y },
        layers: [...step.layers],
      }
}

function allocateSearch(nodeCount: number): {
  parent: Int32Array
  queue: Int32Array
} {
  // Bound the two dense search arrays before allocation. The layered graph
  // may exceed this work domain; that is unknown rather than disconnection.
  const maxParentAndQueueBytes = 64 * 1024 * 1024
  if (nodeCount * Int32Array.BYTES_PER_ELEMENT * 2 > maxParentAndQueueBytes)
    throw new PendingPeerAccessUnknownError(
      "Pending peer search exceeds its 64 MiB parent/queue budget",
    )
  try {
    const parent = new Int32Array(nodeCount)
    parent.fill(-1)
    return { parent, queue: new Int32Array(nodeCount) }
  } catch (error) {
    if (error instanceof RangeError)
      throw new PendingPeerAccessUnknownError(error.message)
    throw error
  }
}

function pointsEqual(first: Point, second: Point): boolean {
  return first.x === second.x && first.y === second.y
}

/** Private geometry and graph for one future net. Native endpoint layers are
 * usable for dogbones, whose extent SRJ does not specify. This is a necessary
 * physical-access condition, not a proof of carrier-route feasibility, routing
 * order, simultaneous manufactured-via placement, or length matching. */
class PeerScene {
  readonly connection: Connection
  private readonly requireCarrier: boolean
  private readonly carrierLayers: ReadonlySet<string>
  readonly layers: string[]
  private readonly scenes: (PendingPadScene | undefined)[]
  readonly anchors: PeerAnchor[] = []
  readonly terminalAnchors: number[][]
  readonly widthMm: number
  private readonly wireLayers: ReadonlySet<string>
  private readonly gridLayerIndices: number[]
  private readonly ownedWires: readonly Copper[]
  private readonly fixedViaSpans: readonly FixedViaSpan[]
  private readonly geometry: PendingPadGeometry
  private readonly ownedAccess: PendingOwnedCarrierAccess
  private readonly anchorIds = new Map<LayerPointKey, number>()
  private readonly grids: (GridRoutingAccess | undefined)[]
  private readonly gridAttachments = new Map<number, GridAttachment[]>()
  private cellCount = 0
  private preparedNodeCount?: number

  constructor(
    readonly input: SimpleRouteJson,
    request: {
      connection: Connection
      requireCarrier: boolean
      ownership?: PendingCopperOwnership
    },
  ) {
    const { connection, requireCarrier } = request
    this.connection = connection
    this.requireCarrier = requireCarrier
    this.geometry = new PendingPadGeometry(input, request.ownership)
    const first = new PendingPadScene(
      { input, connection, terminalIndex: 0 },
      this.geometry,
    )
    this.layers = first.physical
    this.widthMm = first.width
    this.carrierLayers = new Set(first.carrierLayers)
    this.scenes = this.layers.map((layer) =>
      layer === first.terminal.layer ? first : undefined,
    )
    this.wireLayers = new Set([
      ...first.carrierLayers,
      ...connection.pointsToConnect.flatMap(
        (terminal) => terminal.layers ?? [terminal.layer],
      ),
    ])
    this.gridLayerIndices = this.layers.flatMap((layer, index) =>
      this.wireLayers.has(layer) ? [index] : [],
    )
    this.grids = this.layers.map(() => undefined)
    this.terminalAnchors = connection.pointsToConnect.map((terminal) => {
      const layers = [...new Set(terminal.layers ?? [terminal.layer])]
      const anchors = layers.map((layer) => this.anchor(terminal, layer))
      for (const other of anchors.slice(1))
        this.connect({
          from: anchors[0],
          to: other,
          step: {
            kind: "native_transition",
            point: terminal,
            fromLayer: layers[0],
            toLayer: this.anchors[other].layer,
            layers,
          },
        })
      return anchors
    })
    // Existing conductors remain usable on their actual layers even when the
    // future carrier policy excludes those layers. Reuse fixedCopper's span
    // and wire extraction rather than interpreting route vertices differently.
    const ownedAccess = this.geometry.ownedCarrierAccess(connection)
    this.ownedAccess = ownedAccess
    this.ownedWires = ownedAccess.wires
    this.fixedViaSpans = ownedAccess.viaSpans
    for (const copper of this.ownedWires) {
      this.connect({
        from: this.anchor(copper.a, copper.layer),
        to: this.anchor(copper.b, copper.layer),
        step: {
          kind: "wire",
          layer: copper.layer,
          path: [copper.a, copper.b],
          widthMm: copper.radius * 2,
          requiresSuppliedCopper: true,
        },
      })
    }
    for (const { point: via, layers } of this.fixedViaSpans) {
      const firstLayer = layers[0]
      for (const layer of layers.slice(1))
        this.connect({
          from: this.anchor(via, firstLayer),
          to: this.anchor(via, layer),
          step: {
            kind: "fixed_via",
            point: via,
            fromLayer: firstLayer,
            toLayer: layer,
            layers,
          },
        })
    }
    // Actual fixed copper may meet at wire interiors or inside a native pad.
    // Connect its existing anchors by physical component, without inventing a
    // new wire on an excluded layer or resizing an old manufactured conductor.
    for (const component of requireCarrier
      ? []
      : ownedAccess.anchorComponents) {
      let first: number | undefined
      for (const [index, anchor] of this.anchors.entries()) {
        if (!ownedAccess.connectedContacts({ from: anchor, to: component[0] }))
          continue
        if (first === undefined) first = index
        else
          this.connect({
            from: first,
            to: index,
            step: {
              kind: "fixed_component",
              from: this.anchors[first],
              to: anchor,
            },
          })
      }
    }
  }

  private anchor(point: Point, layer: string): number {
    if (!this.layers.includes(layer))
      throw Error(`Unknown pending terminal layer: ${layer}`)
    const key: LayerPointKey = JSON.stringify([layer, point.x, point.y])
    const old = this.anchorIds.get(key)
    if (old !== undefined) return old
    const anchor = this.anchors.length
    this.anchors.push({ point, layer, edges: [], attachments: [] })
    this.anchorIds.set(key, anchor)
    return anchor
  }

  private connect({
    from,
    to,
    step,
  }: {
    from: number
    to: number
    step: PeerStep
  }) {
    this.anchors[from].edges.push({ other: to, step })
    this.anchors[to].edges.push({ other: from, step: reverseStep(step) })
  }

  private layerScene(layerIndex: number): PendingPadScene {
    const old = this.scenes[layerIndex]
    if (old) return old
    const scene = new PendingPadScene(
      {
        input: this.input,
        connection: this.connection,
        terminalIndex: 0,
        terminalLayer: this.layers[layerIndex],
      },
      this.geometry,
    )
    this.scenes[layerIndex] = scene
    return scene
  }

  private get gridNodeCount(): number {
    return this.gridLayerIndices.length * this.cellCount
  }

  private gridNode(layerIndex: number, cell: number): number {
    return this.gridLayerIndices.indexOf(layerIndex) * this.cellCount + cell
  }

  private grid(layerIndex: number): GridRoutingAccess {
    const old = this.grids[layerIndex]
    if (old) return old
    const terminal = this.connection.pointsToConnect[0]
    const access = this.routingAccess({ layerIndex, point: terminal })
    if (this.cellCount && this.cellCount !== access.cellCount)
      throw new PendingPeerAccessUnknownError("Pending peer grids do not align")
    this.cellCount = access.cellCount
    this.grids[layerIndex] = access
    return access
  }

  private attachments(anchor: PeerAnchor): GridRoutingAccess["starts"] {
    if (!this.wireLayers.has(anchor.layer)) return []
    return this.routingAccess({
      layerIndex: this.layers.indexOf(anchor.layer),
      point: anchor.point,
    }).starts
  }

  private routingAccess({
    layerIndex,
    point,
  }: {
    layerIndex: number
    point: Point
  }): GridRoutingAccess {
    try {
      const search = new GridVisibilitySearch(
        this.layerScene(layerIndex).scene,
        point,
        point,
        [],
        0,
        undefined,
        { bounds: this.input.bounds, allTerminalAttachments: true },
      )
      const access = search.getRoutingAccess()
      search.cancel()
      return access
    } catch (error) {
      if (
        error instanceof RangeError ||
        (error instanceof Error &&
          error.message === "Dense grid search budget exceeded")
      )
        throw new PendingPeerAccessUnknownError(error.message)
      throw error
    }
  }

  private prepareGraph(): number {
    if (this.preparedNodeCount !== undefined) return this.preparedNodeCount
    for (const [layerIndex, layer] of this.layers.entries())
      if (this.wireLayers.has(layer)) this.grid(layerIndex)
    for (const [anchorIndex, anchor] of this.anchors.entries()) {
      anchor.attachments = this.attachments(anchor)
      for (const attachment of anchor.attachments) {
        const cell = this.gridNode(
          this.layers.indexOf(anchor.layer),
          attachment.id,
        )
        const old = this.gridAttachments.get(cell) ?? []
        old.push({ anchor: anchorIndex, path: attachment.path })
        this.gridAttachments.set(cell, old)
      }
    }
    const gridNodes = this.gridNodeCount
    const nodeCount = gridNodes + this.anchors.length
    if (!Number.isSafeInteger(nodeCount) || nodeCount > 0x7fffffff)
      throw new PendingPeerAccessUnknownError(
        "Pending peer graph exceeds the numeric parent domain",
      )
    this.preparedNodeCount = nodeCount
    return nodeCount
  }

  private *neighbors(
    node: number,
  ): Generator<{ other: number; step: PeerStep }> {
    const gridNodes = this.gridNodeCount
    if (node >= gridNodes) {
      const anchor = this.anchors[node - gridNodes]
      for (const edge of anchor.edges)
        if (this.stepIsClear(edge.step))
          yield { other: gridNodes + edge.other, step: edge.step }
      for (const attachment of anchor.attachments)
        yield {
          other: this.gridNode(
            this.layers.indexOf(anchor.layer),
            attachment.id,
          ),
          step: {
            kind: "wire",
            layer: anchor.layer,
            path: attachment.path,
            widthMm: this.widthMm,
          },
        }
      return
    }
    const layerIndex = this.gridLayerIndices[Math.floor(node / this.cellCount)]
    const cell = node % this.cellCount
    const access = this.grid(layerIndex)
    const point = access.point(cell)
    const x = cell % access.nx
    const y = Math.floor(cell / access.nx)
    for (const neighbor of access.neighbors) {
      const nx = x + neighbor.dx
      const ny = y + neighbor.dy
      const other = cell + neighbor.offset
      if (
        nx < 0 ||
        nx >= access.nx ||
        ny < 0 ||
        ny >= access.ny ||
        access.isBlocked(other) ||
        !access.hardEdgeIsClear(cell, neighbor)
      )
        continue
      yield {
        other: this.gridNode(layerIndex, other),
        step: {
          kind: "wire",
          layer: this.layers[layerIndex],
          path: [point, access.point(other)],
          widthMm: this.widthMm,
        },
      }
    }
    for (const [otherIndex, otherLayer] of this.layers.entries()) {
      if (otherIndex === layerIndex || !this.wireLayers.has(otherLayer))
        continue
      const otherAccess = this.grid(otherIndex)
      if (otherAccess.isBlocked(cell)) continue
      const layers = this.layerScene(layerIndex).viaSpan(point, otherLayer)
      if (!layers) continue
      yield {
        other: this.gridNode(otherIndex, cell),
        step: {
          kind: "new_via",
          point,
          fromLayer: this.layers[layerIndex],
          toLayer: otherLayer,
          layers,
        },
      }
    }
    for (const attachment of this.gridAttachments.get(node) ?? [])
      yield {
        other: gridNodes + attachment.anchor,
        step: {
          kind: "wire",
          layer: this.layers[layerIndex],
          path: attachment.path.toReversed(),
          widthMm: this.widthMm,
        },
      }
  }

  private stepIsClear(step: PeerStep): boolean {
    if (step.kind === "fixed_component")
      return this.ownedAccess.connectedContacts(step)
    const layerIndex = this.layers.indexOf(
      step.kind === "wire" ? step.layer : step.fromLayer,
    )
    const scene = this.layerScene(layerIndex)
    if (step.kind === "wire") {
      if (
        step.requiresSuppliedCopper &&
        !this.ownedWires.some(
          (copper) =>
            copper.layer === step.layer &&
            copper.radius * 2 === step.widthMm &&
            ((pointsEqual(copper.a, step.path[0]) &&
              pointsEqual(copper.b, step.path[1])) ||
              (pointsEqual(copper.b, step.path[0]) &&
                pointsEqual(copper.a, step.path[1]))),
        )
      )
        return false
      // This is already manufactured physical copper. Future dimensions apply
      // to new work, not to an existing conductor used by the carrier proof.
      if (this.requireCarrier && step.requiresSuppliedCopper) return true
      const widthMm = step.requiresSuppliedCopper ? step.widthMm : this.widthMm
      const wireScene =
        widthMm === this.widthMm
          ? scene.scene
          : this.geometry.createScene({
              input: this.input,
              connection: scene.scene.connection,
              width: widthMm,
              copper: scene.scene.copper,
            })
      return (
        wireScene.visible(step.path[0], step.path[0]) &&
        wireScene.pathVisible(step.path)
      )
    }
    if (step.kind === "native_transition")
      return this.connection.pointsToConnect.some((terminal) => {
        const layers = terminal.layers ?? [terminal.layer]
        return (
          pointsEqual(terminal, step.point) &&
          layers.includes(step.fromLayer) &&
          layers.includes(step.toLayer)
        )
      })
    if (step.kind === "fixed_via")
      return this.fixedViaSpans.some(
        (via) =>
          pointsEqual(via.point, step.point) &&
          via.layers.includes(step.fromLayer) &&
          via.layers.includes(step.toLayer),
      )
    const layers = scene.viaSpan(step.point, step.toLayer)
    return !!layers && step.layers.every((layer) => layers.includes(layer))
  }

  witnessIsClear(witness: PeerWitness): boolean {
    if (witness.existingConnection)
      return (
        this.existingTerminalConnection(witness.fromIndex, witness.toIndex) !==
        undefined
      )
    if (
      this.requireCarrier &&
      !witness.steps.some((step) => this.isCarrier(step))
    )
      return false
    if (this.requireCarrier) this.assertPhysicalCarrierPath(witness.steps)
    return witness.steps.every((step) => this.stepIsClear(step))
  }

  private existingTerminalConnection(
    first: number,
    second: number,
  ): PeerStep[] | undefined {
    const source = this.connection.pointsToConnect[first]
    const target = this.connection.pointsToConnect[second]
    for (const fromLayer of source.layers ?? [source.layer])
      for (const toLayer of target.layers ?? [target.layer])
        if (
          this.ownedAccess.connectedContacts({
            from: { point: source, layer: fromLayer },
            to: { point: target, layer: toLayer },
          })
        )
          return [
            {
              kind: "fixed_component",
              from: { point: source, layer: fromLayer },
              to: { point: target, layer: toLayer },
            },
          ]
    return undefined
  }

  private isCarrier(step: PeerStep): boolean {
    if (step.kind === "wire")
      return this.carrierLayers.has(step.layer) && length(step.path) > 1e-8
    // A genuine manufactured handoff may end directly on a native carrier
    // terminal. Simple-path verification prevents an excursion through the
    // same barrel from masquerading as carrier participation.
    return (
      (step.kind === "new_via" || step.kind === "fixed_via") &&
      step.fromLayer !== step.toLayer &&
      (this.carrierLayers.has(step.fromLayer) ||
        this.carrierLayers.has(step.toLayer))
    )
  }

  private assertPhysicalCarrierPath(steps: readonly PeerStep[]): void {
    const seen = new Set<string>()
    let previous = ""
    const segments: Array<{ a: Point; b: Point; layer: string }> = []
    const visit = (point: Point, layer: string) => {
      const key = JSON.stringify([layer, point.x, point.y])
      if (key === previous) return
      if (seen.has(key))
        throw new PendingPeerAccessUnknownError(
          "Pending carrier path needs unresolved physical cycle negotiation",
        )
      seen.add(key)
      previous = key
    }
    for (const step of steps) {
      if (step.kind === "fixed_component")
        throw new PendingPeerAccessUnknownError(
          "Pending carrier path needs an expanded existing-conductor witness",
        )
      if (step.kind === "wire") {
        for (const point of step.path) visit(point, step.layer)
        const path = simplify(step.path)
        for (let index = 1; index < path.length; index++)
          if (distance(path[index - 1], path[index]) > 1e-8)
            segments.push({
              a: path[index - 1],
              b: path[index],
              layer: step.layer,
            })
      } else {
        visit(step.point, step.fromLayer)
        visit(step.point, step.toLayer)
      }
    }
    for (const [index, first] of segments.entries())
      for (const second of segments.slice(index + 2))
        if (
          first.layer === second.layer &&
          segmentDistance([first.a, first.b], [second.a, second.b]) <= 1e-8
        )
          throw new PendingPeerAccessUnknownError(
            "Pending carrier path needs unresolved physical crossing negotiation",
          )
  }

  private assertExistingAnchorTopology(): void {
    if (!this.ownedAccess.anchorComponents.length) return
    const parents = this.anchors.map((_, index) => index)
    const root = (index: number): number => {
      while (parents[index] !== index) {
        parents[index] = parents[parents[index]]
        index = parents[index]
      }
      return index
    }
    for (const [index, anchor] of this.anchors.entries())
      for (const edge of anchor.edges)
        if (
          edge.step.kind === "fixed_via" ||
          edge.step.kind === "native_transition" ||
          (edge.step.kind === "wire" && edge.step.requiresSuppliedCopper)
        )
          parents[root(edge.other)] = root(index)
    // Carrier search deliberately omits opaque component stars: their hidden
    // physical junctions could turn a graph-simple path into a carrier spur.
    // If exact manufactured copper joins separately represented anchors,
    // failure of this smaller graph is unknown, not a disconnected baseline.
    // New wire/grid attachments still use the existing visibility domain.
    for (const component of this.ownedAccess.anchorComponents) {
      let first: number | undefined
      for (const [index, anchor] of this.anchors.entries()) {
        if (
          !this.ownedAccess.connectedContacts({
            from: anchor,
            to: component[0],
          })
        )
          continue
        const found = root(index)
        if (first === undefined) first = found
        else if (found !== first)
          throw new PendingPeerAccessUnknownError(
            "Pending carrier search needs an expanded existing-conductor topology",
          )
      }
    }
  }

  private *findCarrierPaths({
    sourceIndex,
    targetIndices,
  }: {
    sourceIndex: number
    targetIndices: readonly number[]
  }): Generator<void, Map<number, PeerWitness>> {
    const found = new Map<number, PeerWitness>()
    for (const targetIndex of targetIndices) {
      const existing = this.existingTerminalConnection(sourceIndex, targetIndex)
      if (existing) {
        found.set(targetIndex, {
          fromIndex: sourceIndex,
          toIndex: targetIndex,
          steps: existing.map(snapshotStep),
          existingConnection: true,
        })
        continue
      }
      const nodeCount = this.prepareGraph()
      const gridNodes = this.gridNodeCount
      const path = yield* findSimpleCarrierPath({
        nodeCount,
        sourceNodes: this.terminalAnchors[sourceIndex].map(
          (anchor) => gridNodes + anchor,
        ),
        targetNodes: this.terminalAnchors[targetIndex].map(
          (anchor) => gridNodes + anchor,
        ),
        neighbors: (node) => this.neighbors(node),
        isCarrier: (step) => this.isCarrier(step),
        reverseStep,
      })
      if (!path) {
        this.assertExistingAnchorTopology()
        continue
      }
      const steps = path.steps.map(snapshotStep)
      this.assertPhysicalCarrierPath(steps)
      this.assertViaPlacement(steps)
      const witness = { fromIndex: sourceIndex, toIndex: targetIndex, steps }
      if (!this.witnessIsClear(witness))
        throw new PendingPeerAccessUnknownError(
          "Pending carrier witness lost its physical geometry",
        )
      found.set(targetIndex, witness)
    }
    return found
  }

  private witness({
    sourceIndex,
    targetIndex,
    node,
    parent,
  }: {
    sourceIndex: number
    targetIndex: number
    node: number
    parent: Int32Array
  }): PeerWitness {
    const steps: PeerStep[] = []
    while (parent[node] !== node) {
      const previous = parent[node]
      const edge = [...this.neighbors(previous)].find(
        (candidate) => candidate.other === node,
      )
      if (!edge)
        throw new PendingPeerAccessUnknownError(
          "Pending peer witness lost its continuous edge",
        )
      steps.push(snapshotStep(edge.step))
      node = previous
    }
    steps.reverse()
    this.assertViaPlacement(steps)
    return { fromIndex: sourceIndex, toIndex: targetIndex, steps }
  }

  private assertViaPlacement(steps: readonly PeerStep[]): void {
    // A sampled graph can be disconnected without proving continuous absence.
    // A positive witness, however, must not claim two drill holes can overlap.
    const vias = steps.filter(
      (step): step is PeerTransition => step.kind === "new_via",
    )
    const holeClearanceMm =
      this.input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
    for (const [index, via] of vias.entries())
      if (
        vias
          .slice(index + 1)
          .some(
            (other) =>
              via.layers.some((layer) => other.layers.includes(layer)) &&
              distance(via.point, other.point) <
                (this.input.minViaHoleDiameter ?? 0.15) +
                  holeClearanceMm -
                  1e-8,
          )
      )
        throw new PendingPeerAccessUnknownError(
          "Pending peer graph path needs unresolved via-placement negotiation",
        )
  }

  *findPaths({
    sourceIndex,
    targetIndices,
  }: {
    sourceIndex: number
    targetIndices: readonly number[]
  }): Generator<void, Map<number, PeerWitness>> {
    if (this.requireCarrier)
      return yield* this.findCarrierPaths({ sourceIndex, targetIndices })
    const nodeCount = this.prepareGraph()
    // Integer-domain and allocation failures propagate as unknown; neither is
    // converted into a disconnected component or a successful access check.
    const { parent, queue } = allocateSearch(nodeCount)
    const gridNodes = this.gridNodeCount
    let tail = 0
    for (const anchor of this.terminalAnchors[sourceIndex]) {
      const node = gridNodes + anchor
      parent[node] = node
      queue[tail++] = node
    }
    const targets = new Map<number, number[]>()
    for (const targetIndex of targetIndices)
      for (const anchor of this.terminalAnchors[targetIndex]) {
        const node = gridNodes + anchor
        const old = targets.get(node) ?? []
        old.push(targetIndex)
        targets.set(node, old)
      }
    const found = new Map<number, PeerWitness>()
    for (let head = 0; head < tail; head++) {
      const node = queue[head]
      for (const targetIndex of targets.get(node) ?? [])
        if (!found.has(targetIndex))
          found.set(
            targetIndex,
            this.witness({ sourceIndex, targetIndex, node, parent }),
          )
      if (found.size === targetIndices.length) return found
      for (const edge of this.neighbors(node)) {
        if (parent[edge.other] >= 0) continue
        parent[edge.other] = node
        queue[tail++] = edge.other
      }
      if (head % 256 === 0) yield
    }
    return found
  }
}

/** Preserve positive original peer connectivity and require certificates for
 * relations the finite original search could not resolve. A finite graph miss
 * never proves physical disconnection. Witnesses remain private and never
 * reserve corridors or become output copper. */
export class PendingPeerAccess {
  private forest?: PeerLinkState[]
  private links?: readonly PendingPeerLink[]
  private requiredLinks?: readonly PendingPeerLink[]
  private requireCarrier = false
  private readonly connection: Connection
  private readonly ownership: PendingCopperOwnership
  private readonly originalTraceKey: string

  constructor(
    private readonly input: SimpleRouteJson,
    request:
      | Connection
      | { connection: Connection; ownership: PendingCopperOwnership },
  ) {
    this.connection =
      "pointsToConnect" in request ? request : request.connection
    this.ownership =
      "pointsToConnect" in request
        ? new PendingCopperOwnership(input)
        : request.ownership
    let traceKey = originalTraceKeys.get(input)
    if (traceKey === undefined) {
      traceKey = traceUnionKey(input)
      originalTraceKeys.set(input, traceKey)
    }
    this.originalTraceKey = traceKey
  }

  /** Exact original copper and policy can establish relational no-new-loss,
   * but cannot manufacture a positive peer-connection certificate. Normalize
   * trace ordering only; all geometry, ownership and policy values remain. */
  private isOriginalUnion(candidate: SimpleRouteJson): boolean {
    if ((candidate.traces?.length ?? 0) !== (this.input.traces?.length ?? 0))
      return false
    const originalKeys = Object.keys(this.input).filter(
      (key) => key !== "traces",
    ) as (keyof SimpleRouteJson)[]
    const candidateKeys = Object.keys(candidate).filter(
      (key) => key !== "traces",
    ) as (keyof SimpleRouteJson)[]
    // Reference equality is sufficient under the immutable declaration
    // contract, and conservative for cloned-but-equal metadata. Check every
    // property, so unchanged trace copper never masks a changed future rule.
    if (
      originalKeys.length !== candidateKeys.length ||
      originalKeys.some(
        (key) =>
          !Object.hasOwn(candidate, key) || candidate[key] !== this.input[key],
      )
    )
      return false
    return (
      candidate.traces === this.input.traces ||
      traceUnionKey(candidate) === this.originalTraceKey
    )
  }

  /** Internal package work needs a physical carrier path, rather than an
   * arbitrary walk on native approach layers. Activation is decided from the
   * complete original baseline by PendingPadAccess. */
  static forInternalPackage(
    input: SimpleRouteJson,
    request:
      | Connection
      | { connection: Connection; ownership: PendingCopperOwnership },
  ): PendingPeerAccess {
    const access = new PendingPeerAccess(input, request)
    access.requireCarrier = true
    return access
  }

  *getBaselineLinks(): Generator<void, readonly PendingPeerLink[]> {
    if (this.links) return this.links
    const witnesses: PeerWitness[] = []
    if (this.connection.pointsToConnect.length >= 2) {
      const baseline = new PeerScene(this.input, {
        connection: this.connection,
        requireCarrier: this.requireCarrier,
        ownership: this.ownership,
      })
      const assigned = new Set<number>()
      for (const sourceIndex of this.connection.pointsToConnect.keys()) {
        if (assigned.has(sourceIndex)) continue
        assigned.add(sourceIndex)
        const targetIndices = [
          ...this.connection.pointsToConnect.keys(),
        ].filter((index) => !assigned.has(index))
        if (!targetIndices.length) continue
        const paths = yield* baseline.findPaths({ sourceIndex, targetIndices })
        for (const [targetIndex, witness] of paths) {
          assigned.add(targetIndex)
          witnesses.push(witness)
        }
      }
    }
    // Interleaved initializers may finish in either order. Commit only the
    // first complete original forest; no query may replace its link identities.
    // A resource exception or cancellation above publishes no partial forest.
    if (!this.links) {
      const positive = witnesses.map(
        (witness): PeerLinkState => ({
          link: Object.freeze({
            sourceTerminalIndex: witness.fromIndex,
            targetTerminalIndex: witness.toIndex,
          }),
          baselineUnresolved: false,
          witness,
        }),
      )
      // Positive components are real connectivity facts. Their missing joins
      // are unresolved, not inaccessible: retain a stable spanning set of
      // those joins so final acceptance must positively connect the net.
      const roots = this.connection.pointsToConnect.map((_, index) => index)
      const root = (index: number): number => {
        while (roots[index] !== index) index = roots[index]
        return index
      }
      for (const state of positive)
        roots[root(state.link.targetTerminalIndex)] = root(
          state.link.sourceTerminalIndex,
        )
      const representatives = [...new Set(roots.map((_, index) => root(index)))]
      const unresolved = representatives.slice(1).map(
        (target): PeerLinkState => ({
          link: Object.freeze({
            sourceTerminalIndex: representatives[0],
            targetTerminalIndex: target,
          }),
          baselineUnresolved: true,
        }),
      )
      const forest = [...positive, ...unresolved]
      const links = Object.freeze(positive.map((state) => state.link))
      const requiredLinks = Object.freeze(forest.map((state) => state.link))
      this.forest = forest
      this.links = links
      this.requiredLinks = requiredLinks
    }
    return this.links
  }

  /** Positive original forest plus unresolved component joins. Together they
   * require a complete future connection without declaring a search miss lost. */
  *getRequiredLinks(): Generator<void, readonly PendingPeerLink[]> {
    yield* this.getBaselineLinks()
    return this.requiredLinks!
  }

  isBaselineUnresolved(link: PendingPeerLink): boolean {
    const state = this.forest?.find((candidate) => candidate.link === link)
    if (!state)
      throw Error("Pending peer query must reference an original baseline link")
    return state.baselineUnresolved
  }

  *getBlockedLinks(
    candidateInput: SimpleRouteJson,
    scope?: {
      links?: ReadonlySet<PendingPeerLink>
      stopAfterFirst?: boolean
      /** Final acceptance needs a positive path even when the union is exactly
       * unchanged; relational no-new-loss is insufficient evidence. */
      requireCertificates?: boolean
    },
  ): Generator<void, PendingPeerLink[]> {
    // A caller may reuse its selection set while this cooperative query is
    // suspended. Capture it before baseline initialization can yield.
    const requested = scope?.links ? new Set(scope.links) : undefined
    const stopAfterFirst = scope?.stopAfterFirst === true
    const requireCertificates = scope?.requireCertificates === true
    // The caller owns an immutable candidate-union lease for this entire
    // cooperative query. PendingPadAccess snapshots it once before any yield;
    // copying the complete copper again for every peer would multiply memory.
    const unchanged =
      !requireCertificates && this.isOriginalUnion(candidateInput)
    const links = yield* this.getRequiredLinks()
    for (const link of requested ?? [])
      if (!links.includes(link))
        throw Error(
          "Pending peer query must reference an original baseline link",
        )
    const selected = this.forest!.filter(
      (state) => !requested || requested.has(state.link),
    )
    if (!selected.length) return []
    const candidate = new PeerScene(candidateInput, {
      connection: this.connection,
      requireCarrier: this.requireCarrier,
      ownership: this.ownership,
    })
    const blocked: PendingPeerLink[] = []
    for (const state of selected) {
      if (state.baselineUnresolved && unchanged && !requireCertificates)
        continue
      const witness = state.witness
      if (witness && candidate.witnessIsClear(witness)) continue
      const paths = yield* candidate.findPaths({
        sourceIndex: state.link.sourceTerminalIndex,
        targetIndices: [state.link.targetTerminalIndex],
      })
      const replacement = paths.get(state.link.targetTerminalIndex)
      if (!replacement) {
        blocked.push(state.link)
        if (stopAfterFirst) return blocked
      } else state.witness = replacement
    }
    return blocked
  }

  *getBlockedConnections(
    candidateInput: SimpleRouteJson,
  ): Generator<void, boolean> {
    if (yield* this.getUncertifiedConnections(candidateInput))
      throw new PendingAccessSearchUnknownError()
    return false
  }

  /** A finite search miss demands another candidate or a positive witness;
   * it never certifies continuous disconnection. */
  *getUncertifiedConnections(
    candidateInput: SimpleRouteJson,
  ): Generator<void, boolean> {
    return (
      (yield* this.getBlockedLinks(candidateInput, { stopAfterFirst: true }))
        .length > 0
    )
  }
}
