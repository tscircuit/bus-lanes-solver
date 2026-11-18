import { applyToPoint } from "transformation-matrix"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { PendingCopperOwnership } from "./pending-copper-ownership"
import type { Connection, Point, SimpleRouteJson, Via } from "./types"
import { clearanceToCopper, type Copper } from "./vector-scene"

export interface OwnedViaSpan {
  point: Point
  layers: string[]
}

export interface OwnedCarrierTarget {
  readonly point: Point
  readonly layer: string
}

export interface PreparedOwnedCarrierTargets {
  findCarrier(request: {
    point: Point
    layer: string
    width: number
  }): OwnedCarrierTarget | undefined
}

const emptyCarrierTargets: PreparedOwnedCarrierTargets = Object.freeze({
  findCarrier: () => undefined,
})

interface OwnedCarrierInput {
  input: SimpleRouteJson
  connection: Connection
  /** Actual physical copper, without expanded drill-clearance shapes. */
  ownedCopper: readonly Copper[]
  ownedTraceCopper: readonly Copper[]
  ownedVias: readonly Via[]
  owners?: ReadonlySet<string>
}

function corners(copper: Copper): Point[] {
  const rectangle = copper.orientedRect?.rect ?? copper.rect
  if (!rectangle) return []
  const points = [
    { x: rectangle.minX, y: rectangle.minY },
    { x: rectangle.maxX, y: rectangle.minY },
    { x: rectangle.maxX, y: rectangle.maxY },
    { x: rectangle.minX, y: rectangle.maxY },
  ]
  return copper.orientedRect
    ? points.map((point) =>
        applyToPoint(copper.orientedRect!.padToBoard, point),
      )
    : points
}

/** Electrical contact uses actual copper, without routing clearance. */
function touches(first: Copper, second: Copper): boolean {
  if (first.layer !== second.layer) return false
  if (!first.rect)
    return clearanceToCopper(first.a, first.b, second) <= first.radius + 1e-8
  if (!second.rect)
    return clearanceToCopper(second.a, second.b, first) <= second.radius + 1e-8
  const points = corners(first)
  return (
    points.some(
      (point, index) =>
        clearanceToCopper(point, points[(index + 1) % points.length], second) <=
        1e-8,
    ) ||
    corners(second).some(
      (point) => clearanceToCopper(point, point, first) <= 1e-8,
    )
  )
}

/** Physical components of one net's existing pads, wires and via barrels.
 * Ownership selects conductors; only geometric contact makes them connected.
 * A new instance belongs to one immutable candidate union. */
export class PendingOwnedCarrierAccess {
  readonly wires: Copper[]
  readonly viaSpans: OwnedViaSpan[]
  readonly anchors: readonly OwnedCarrierTarget[]
  readonly anchorComponents: readonly (readonly OwnedCarrierTarget[])[]
  private readonly copper: Copper[]
  private readonly roots: number[]
  private readonly connection: Connection
  private readonly hasTraceCopper: boolean

  constructor({
    input,
    connection,
    ownedCopper,
    ownedTraceCopper,
    ownedVias,
    owners = new PendingCopperOwnership(input).owners(connection),
  }: OwnedCarrierInput) {
    this.connection = connection
    const owned = (shape: Copper) =>
      shape.owners.some((owner) => owners.has(owner))
    const traceCopper = ownedTraceCopper.filter(owned)
    this.hasTraceCopper = traceCopper.length > 0
    this.wires = traceCopper.filter((shape) => shape.a !== shape.b)
    if (!this.hasTraceCopper) {
      this.copper = []
      this.roots = []
      this.viaSpans = []
      this.anchors = []
      this.anchorComponents = []
      return
    }
    this.copper = ownedCopper.filter(owned)
    const physical = getCopperLayerNames(input.layerCount)
    this.viaSpans = ownedVias.flatMap((via) => {
      if (!traceCopper.some((shape) => shape.a === via && shape.b === via))
        return []
      const from = physical.indexOf(via.from_layer)
      const to = physical.indexOf(via.to_layer)
      const layers =
        via.layers ?? physical.slice(Math.min(from, to), Math.max(from, to) + 1)
      return [{ point: via, layers: [...layers] }]
    })
    this.roots = this.copper.map((_, index) => index)
    for (const [index, shape] of this.copper.entries())
      for (let other = index + 1; other < this.copper.length; other++)
        if (touches(shape, this.copper[other])) this.join(index, other)
    for (const via of this.viaSpans) {
      const contacts = this.copper.flatMap((shape, index) =>
        via.layers.includes(shape.layer) &&
        clearanceToCopper(via.point, via.point, shape) <= 1e-8
          ? [index]
          : [],
      )
      for (const other of contacts.slice(1)) this.join(contacts[0], other)
    }
    // Explicit native multilayer terminals already provide conductivity.
    // Their layers do not authorize manufacturing another via at that point.
    for (const terminal of connection.pointsToConnect) {
      const contacts = this.copper.flatMap((shape, index) =>
        (terminal.layers ?? [terminal.layer]).includes(shape.layer) &&
        clearanceToCopper(terminal, terminal, shape) <= 1e-8
          ? [index]
          : [],
      )
      for (const other of contacts.slice(1)) this.join(contacts[0], other)
    }
    for (let index = 0; index < this.roots.length; index++)
      this.roots[index] = this.root(index)
    const anchors = new Map<string, OwnedCarrierTarget>()
    for (const shape of this.copper)
      for (const point of [shape.a, shape.b, ...corners(shape)]) {
        const key = JSON.stringify([shape.layer, point.x, point.y])
        if (!anchors.has(key))
          anchors.set(
            key,
            Object.freeze({
              point: Object.freeze({ x: point.x, y: point.y }),
              layer: shape.layer,
            }),
          )
      }
    this.anchors = Object.freeze([...anchors.values()])
    const groups = new Map<number, OwnedCarrierTarget[]>()
    for (const anchor of this.anchors)
      for (const root of this.contacts({
        point: anchor.point,
        layers: [anchor.layer],
        radius: 0,
      })) {
        const group = groups.get(root) ?? []
        group.push(anchor)
        groups.set(root, group)
      }
    this.anchorComponents = Object.freeze(
      [...groups.values()].map((group) => Object.freeze(group)),
    )
  }

  private root(index: number): number {
    while (this.roots[index] !== index) {
      this.roots[index] = this.roots[this.roots[index]]
      index = this.roots[index]
    }
    return index
  }

  private join(first: number, second: number): void {
    this.roots[this.root(second)] = this.root(first)
  }

  private contacts({
    point,
    layers,
    radius,
  }: {
    point: Point
    layers: readonly string[]
    radius: number
  }): Set<number> {
    return new Set(
      this.copper.flatMap((shape, index) =>
        layers.includes(shape.layer) &&
        clearanceToCopper(point, point, shape) <= radius + 1e-8
          ? [this.roots[index]]
          : [],
      ),
    )
  }

  /** Only an already complete declared net needs no additional access.
   * A connected subset still needs to reach every remaining peer. */
  hasExistingCompleteConnection(terminalIndex: number): boolean {
    if (!this.hasTraceCopper || this.connection.pointsToConnect.length < 2)
      return false
    const terminal = this.connection.pointsToConnect[terminalIndex]
    const source = this.contacts({
      point: terminal,
      layers: terminal.layers ?? [terminal.layer],
      radius: 0,
    })
    return this.connection.pointsToConnect.every(
      (other, index) =>
        index === terminalIndex ||
        [
          ...this.contacts({
            point: other,
            layers: other.layers ?? [other.layer],
            radius: 0,
          }),
        ].some((root) => source.has(root)),
    )
  }

  /** An already manufactured conductor may have physically left its package
   * before this phase. No new future-width attachment is needed to establish
   * that existing egress. Probe exact support points along the field normals:
   * rectangle corners and capsule/circle extrema cover the field's four
   * half-spaces, including rotated packages and finite conductor widths. */
  findOutsideContact({
    from,
    carrierLayers,
    directions,
    isOutside,
  }: {
    from: OwnedCarrierTarget
    carrierLayers: readonly string[]
    directions: readonly Point[]
    isOutside(point: Point): boolean
  }): OwnedCarrierTarget | undefined {
    if (!this.hasTraceCopper) return undefined
    const source = this.contacts({
      point: from.point,
      layers: [from.layer],
      radius: 0,
    })
    if (!source.size) return undefined
    for (const [index, copper] of this.copper.entries()) {
      if (
        !source.has(this.roots[index]) ||
        !carrierLayers.includes(copper.layer)
      )
        continue
      const points = corners(copper)
      if (!copper.rect)
        for (const direction of directions) {
          const norm = Math.hypot(direction.x, direction.y)
          if (!norm) continue
          for (const endpoint of [copper.a, copper.b])
            points.push({
              x: endpoint.x + (copper.radius * direction.x) / norm,
              y: endpoint.y + (copper.radius * direction.y) / norm,
            })
        }
      for (const point of points)
        if (isOutside(point))
          return { point: { x: point.x, y: point.y }, layer: copper.layer }
    }
    return undefined
  }

  /** Use the caller's existing routing domain. Exact conductor anchors also
   * retain non-grid handoffs; interior wire handoffs are tested by grid points.
   * Each returned view owns its targets, so concurrent terminal scenes cannot
   * replace one another's native-layer, width or carrier policy. */
  *prepareCarrierTargets({
    nativeLayer,
    width,
    carrierLayers,
    carrierPoints,
    carrierPointIsClear,
    isCarrierExit,
  }: {
    nativeLayer: string
    width: number
    carrierLayers: readonly string[]
    carrierPoints(layer: string): Iterable<Point>
    carrierPointIsClear(point: Point, layer: string): boolean
    isCarrierExit(point: Point, layer: string): boolean
  }): Generator<void, PreparedOwnedCarrierTargets> {
    if (!this.hasTraceCopper) return emptyCarrierTargets
    const targets = new Map<number, OwnedCarrierTarget>()
    const prepared: PreparedOwnedCarrierTargets = Object.freeze({
      findCarrier: ({
        point,
        layer,
        width: approachWidth,
      }: Parameters<PreparedOwnedCarrierTargets["findCarrier"]>[0]) => {
        if (layer !== nativeLayer) return undefined
        for (const root of this.contacts({
          point,
          layers: [layer],
          radius: approachWidth / 2,
        })) {
          const target = targets.get(root)
          if (target) return { point: { ...target.point }, layer: target.layer }
        }
        return undefined
      },
    })
    let scanned = 0
    for (const layer of carrierLayers) {
      const points: Iterable<Point>[] = [
        this.anchors
          .filter((anchor) => anchor.layer === layer)
          .map((anchor) => anchor.point),
        carrierPoints(layer),
      ]
      for (const probes of points)
        for (const point of probes) {
          if (
            (layer !== nativeLayer || isCarrierExit(point, layer)) &&
            carrierPointIsClear(point, layer)
          )
            for (const root of this.contacts({
              point,
              layers: [layer],
              radius: width / 2,
            }))
              if (!targets.has(root))
                targets.set(root, {
                  point: { x: point.x, y: point.y },
                  layer,
                })
          if (++scanned % 256 === 0) yield
        }
    }
    return prepared
  }

  /** Revalidate a cached goal against this union's actual conductor graph.
   * The caller separately rechecks carrier policy and future-width clearance. */
  connectedToCarrier({
    point,
    layer,
    width,
    target,
  }: {
    point: Point
    layer: string
    width: number
    target: OwnedCarrierTarget
  }): boolean {
    if (!this.hasTraceCopper) return false
    const source = this.contacts({
      point,
      layers: [layer],
      radius: width / 2,
    })
    for (const root of this.contacts({
      point: target.point,
      layers: [target.layer],
      radius: width / 2,
    }))
      if (source.has(root)) return true
    return false
  }

  /** Exact fixed-copper connectivity for retained peer graph edges. Endpoints
   * are coordinates, never component IDs borrowed from another union. */
  connectedContacts({
    from,
    to,
  }: {
    from: OwnedCarrierTarget
    to: OwnedCarrierTarget
  }): boolean {
    if (!this.hasTraceCopper) return false
    const source = this.contacts({
      point: from.point,
      layers: [from.layer],
      radius: 0,
    })
    for (const root of this.contacts({
      point: to.point,
      layers: [to.layer],
      radius: 0,
    }))
      if (source.has(root)) return true
    return false
  }
}
