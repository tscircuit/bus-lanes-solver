import { applyToPoint } from "transformation-matrix"
import { effectiveCarrierLayers } from "./effective-carrier-layers"
import { GridVisibilitySearch, type GridRoutingAccess } from "./grid-visibility"
import { acquireGridScratch } from "./grid-scratch"
import { distance } from "./geometry"
import type { PackagePadFrame } from "./package-pad-frame"
import { PendingPadGeometry } from "./pending-pad-geometry"
import { PendingCopperOwnership } from "./pending-copper-ownership"
import type {
  PendingOwnedCarrierAccess,
  PreparedOwnedCarrierTargets,
} from "./pending-owned-carrier-access"
import { signalWidth } from "./repair-bus-dogbones"
import type { Connection, Point, SimpleRouteJson, Terminal, Via } from "./types"
import {
  clearanceToCopper,
  copperTooClose,
  fixedCopper,
  VectorScene,
} from "./vector-scene"

export interface PendingPadEscape {
  path: Point[]
  layer: string
  via?: { point: Point; layers: string[] }
  ownedCarrier?: { point: Point; layer: string }
  existingEgress?: { point: Point; layer: string }
  existingCompleteConnection?: true
}

export interface PendingPadRequest {
  input: SimpleRouteJson
  connection: Connection
  terminalIndex: number
  terminalLayer?: string
}

export function pendingPointIsOutsidePackage({
  point,
  frame,
  marginMm = 0,
}: {
  point: Point
  frame: PackagePadFrame
  marginMm?: number
}): boolean {
  const local = applyToPoint(frame.boardToPackage, point)
  return (
    local.x < frame.field.minX - marginMm ||
    local.x > frame.field.maxX + marginMm ||
    local.y < frame.field.minY - marginMm ||
    local.y > frame.field.maxY + marginMm
  )
}

/** Continuous geometry for one future terminal in board-world mm, +X right
 * and +Y up. Search witnesses are private and never become output copper. */
export class PendingPadScene {
  readonly terminal: Terminal
  readonly scene: VectorScene
  readonly physical: string[]
  readonly carrierLayers: string[]
  readonly frame: PackagePadFrame | undefined
  readonly width: number
  private readonly landingScenes: VectorScene[][]
  private readonly padCopper: ReturnType<typeof fixedCopper>
  private readonly oldVias: Via[]
  private readonly viaDiameter: number
  private readonly holeDiameter: number
  private readonly geometry: PendingPadGeometry
  private readonly ownedAccess: PendingOwnedCarrierAccess
  private readonly carrierScenes = new Map<string, VectorScene>()
  private ownedTargets?: PreparedOwnedCarrierTargets

  constructor(
    readonly request: PendingPadRequest,
    geometry = new PendingPadGeometry(request.input),
  ) {
    const { input, connection, terminalIndex } = request
    geometry.assertMatches(input)
    this.geometry = geometry
    this.ownedAccess = geometry.ownedCarrierAccess(connection)
    this.terminal = {
      ...connection.pointsToConnect[terminalIndex],
      layer:
        request.terminalLayer ??
        connection.pointsToConnect[terminalIndex].layer,
    }
    this.width = signalWidth(input, connection)
    this.physical = geometry.physical
    this.carrierLayers = effectiveCarrierLayers(input, connection)
    const terminalConnection = {
      ...connection,
      pointsToConnect: connection.pointsToConnect.map((point) => ({
        ...point,
        layer: this.terminal.layer,
      })),
    }
    this.scene = geometry.createScene({
      input,
      connection: terminalConnection,
      width: this.width,
      copper: geometry.traceSceneCopper,
    })
    const pad = componentPadAtTerminal({
      input,
      terminal: this.terminal,
      layers: [this.terminal.layer],
      owners: this.scene.owners,
    })
    this.frame = pad?.componentId
      ? geometry.frameByComponent.get(pad.componentId)
      : undefined
    this.padCopper = geometry.padCopper
    this.viaDiameter = geometry.viaDiameter
    this.holeDiameter = geometry.holeDiameter
    this.oldVias = geometry.oldVias
    this.landingScenes = this.physical.map((layer) => {
      const layered = {
        ...connection,
        pointsToConnect: connection.pointsToConnect.map((point) => ({
          ...point,
          layer,
        })),
      }
      const scenes = [
        geometry.createScene({
          input,
          connection: layered,
          width: this.viaDiameter,
          copper: geometry.wireCopper,
          kind: "via-land",
        }),
        geometry.createScene({
          input: geometry.landingInput,
          connection: layered,
          width: this.viaDiameter,
          copper: geometry.padsAndVias,
          kind: "via-land",
        }),
      ]
      return scenes
    })
  }

  surfaceExit(point: Point): boolean {
    if (!this.carrierLayers.includes(this.terminal.layer)) return false
    return this.outsidePackage(point)
  }

  private outsidePackage(point: Point): boolean {
    if (!this.frame) return false
    return pendingPointIsOutsidePackage({
      point,
      frame: this.frame,
      marginMm: this.width / 2,
    })
  }

  hasExistingCompleteConnection(): boolean {
    return this.ownedAccess.hasExistingCompleteConnection(
      this.request.terminalIndex,
    )
  }

  existingEgress(): { point: Point; layer: string } | undefined {
    const frame = this.frame
    if (!frame || !this.ownedAccess.anchors.length) return undefined
    const { a, b, c, d } = frame.packageToBoard
    return this.ownedAccess.findOutsideContact({
      from: { point: this.terminal, layer: this.terminal.layer },
      carrierLayers: this.carrierLayers,
      directions: [
        { x: a, y: b },
        { x: -a, y: -b },
        { x: c, y: d },
        { x: -c, y: -d },
      ],
      // A pad defining the field merely touches its boundary. Ignore numeric
      // round-trip noise when proving that old copper actually crosses it.
      isOutside: (point) =>
        pendingPointIsOutsidePackage({ point, frame, marginMm: 1e-8 }),
    })
  }

  existingEgressIsClear(target: { point: Point; layer: string }): boolean {
    return (
      !!this.frame &&
      this.carrierLayers.includes(target.layer) &&
      pendingPointIsOutsidePackage({
        point: target.point,
        frame: this.frame,
        marginMm: 1e-8,
      }) &&
      this.ownedAccess.connectedContacts({
        from: { point: this.terminal, layer: this.terminal.layer },
        to: target,
      })
    )
  }

  private carrierScene(layer: string): VectorScene {
    let scene = this.carrierScenes.get(layer)
    if (!scene) {
      const { input, connection } = this.request
      scene = this.geometry.createScene({
        input,
        connection: {
          ...connection,
          pointsToConnect: connection.pointsToConnect.map((point) => ({
            ...point,
            layer,
          })),
        },
        width: this.width,
        copper: this.geometry.traceSceneCopper,
      })
      this.carrierScenes.set(layer, scene)
    }
    return scene
  }

  private carrierTargetIsClear(target: {
    point: Point
    layer: string
  }): boolean {
    return (
      this.carrierLayers.includes(target.layer) &&
      (target.layer !== this.terminal.layer ||
        this.outsidePackage(target.point)) &&
      this.carrierScene(target.layer).visible(target.point, target.point)
    )
  }

  /** Existing copper has its manufactured dimensions. Only the new native
   * approach and carrier continuation use this phase's future wire width. */
  ownedCarrierIsClear(query: {
    point: Point
    target: { point: Point; layer: string }
  }): boolean {
    return (
      this.carrierTargetIsClear(query.target) &&
      this.ownedAccess.connectedToCarrier({
        ...query,
        layer: this.terminal.layer,
        width: this.width,
      })
    )
  }

  private *carrierPoints(layer: string): Generator<Point> {
    const { input } = this.request
    const search = new GridVisibilitySearch(
      this.carrierScene(layer),
      this.terminal,
      this.terminal,
      [],
      0,
      undefined,
      { bounds: input.bounds, allTerminalAttachments: true },
    )
    const access = search.getRoutingAccess()
    search.cancel()
    // Return blocked cells too: the target preparer checks continuous future-
    // width clearance and yields regularly even when the whole grid is blocked.
    for (let cell = 0; cell < access.cellCount; cell++) yield access.point(cell)
  }

  *prepareOwnedCarrierTargets(): Generator<void> {
    this.ownedTargets ??= yield* this.ownedAccess.prepareCarrierTargets({
      nativeLayer: this.terminal.layer,
      width: this.width,
      carrierLayers: this.carrierLayers,
      carrierPoints: (layer) => this.carrierPoints(layer),
      carrierPointIsClear: (point, layer) =>
        this.carrierScene(layer).visible(point, point),
      isCarrierExit: (point, _layer) => this.outsidePackage(point),
    })
  }

  ownedCarrier(point: Point): { point: Point; layer: string } | undefined {
    return this.ownedTargets?.findCarrier({
      point,
      layer: this.terminal.layer,
      width: this.width,
    })
  }

  viaLayers(point: Point): string[] | undefined {
    for (const target of this.carrierLayers) {
      const span = this.viaSpan(point, target)
      if (span) return span
    }
    return undefined
  }

  /** Manufacturing feasibility for a specific transition. The caller owns
   * carrier-policy validation; this also supports reverse native approaches. */
  viaSpan(point: Point, target: string): string[] | undefined {
    const { input } = this.request
    const holeClearance = input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
    const from = this.physical.indexOf(this.terminal.layer)
    if (target === this.terminal.layer || !this.physical.includes(target))
      return undefined
    const to = this.physical.indexOf(target)
    const span = input.allowBlindAndBuriedVias
      ? this.physical.slice(Math.min(from, to), Math.max(from, to) + 1)
      : this.physical
    if (
      !input.allowViaInPad &&
      this.padCopper.some(
        (pad) =>
          span.includes(pad.layer) &&
          copperTooClose(point, point, pad, this.holeDiameter / 2 - 1e-8),
      )
    )
      return undefined
    if (
      span.some((layer) =>
        this.landingScenes[this.physical.indexOf(layer)].some(
          (scene) => !scene.visible(point, point),
        ),
      )
    )
      return undefined
    if (
      this.oldVias.some((via) => {
        const oldFrom = this.physical.indexOf(via.from_layer)
        const oldTo = this.physical.indexOf(via.to_layer)
        const oldSpan =
          via.layers ??
          this.physical.slice(
            Math.min(oldFrom, oldTo),
            Math.max(oldFrom, oldTo) + 1,
          )
        return (
          oldSpan.some((layer) => span.includes(layer)) &&
          distance(point, via) <
            this.holeDiameter / 2 +
              (via.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15) / 2 +
              holeClearance -
              1e-8
        )
      })
    )
      return undefined
    return span
  }
}

function componentPadAtTerminal({
  input,
  terminal,
  layers,
  owners,
}: {
  input: SimpleRouteJson
  terminal: Point
  layers: readonly string[]
  owners: ReadonlySet<string>
}) {
  return input.obstacles.find(
    (candidate) =>
      candidate.componentId &&
      candidate.connectedTo.some((owner) => owners.has(owner)) &&
      fixedCopper({ ...input, obstacles: [candidate], traces: [] }).some(
        (shape) =>
          layers.includes(shape.layer) &&
          clearanceToCopper(terminal, terminal, shape) <= 1e-8,
      ),
  )
}

/** Metadata classification only; framed native pads retain their existing
 * package-access path without constructing an unframed peer graph. */
export function pendingTerminalHasPackage(request: PendingPadRequest): boolean {
  const { input, connection, terminalIndex } = request
  const terminal = connection.pointsToConnect[terminalIndex]
  return !!componentPadAtTerminal({
    input,
    terminal,
    layers: terminal.layers ?? [terminal.layer],
    owners: new PendingCopperOwnership(input).owners(connection),
  })
}

export function pendingTerminalPackageFrame(
  request: PendingPadRequest,
  geometry: PendingPadGeometry,
): PackagePadFrame | undefined {
  geometry.assertMatches(request.input)
  const { input, connection, terminalIndex } = request
  const terminal = connection.pointsToConnect[terminalIndex]
  const pad = componentPadAtTerminal({
    input,
    terminal,
    layers: terminal.layers ?? [terminal.layer],
    owners: geometry.ownership.owners(connection),
  })
  return pad?.componentId
    ? geometry.frameByComponent.get(pad.componentId)
    : undefined
}

/** Revalidate a positive continuous path/barrel witness against changed copper.
 * A blocked witness triggers a new search; it is never a mandatory corridor. */
export function pendingPadEscapeIsClear(
  request: PendingPadRequest,
  escape: PendingPadEscape,
): boolean {
  return new PendingPadEscapeCheck(request).isClear(escape)
}

/** One immutable terminal/union check. All its positive witnesses and a
 * subsequent flood reuse one physical scene per native layer. The check is
 * private to the union lease; no mutable index crosses scene changes. */
export class PendingPadEscapeCheck {
  private readonly scenes = new Map<string, PendingPadScene>()

  constructor(
    private readonly request: PendingPadRequest,
    private geometry?: PendingPadGeometry,
  ) {}

  private sceneForLayer(layer: string): PendingPadScene {
    this.geometry ??= new PendingPadGeometry(this.request.input)
    this.geometry.assertMatches(this.request.input)
    let scene = this.scenes.get(layer)
    if (!scene) {
      scene = new PendingPadScene(
        { ...this.request, terminalLayer: layer },
        this.geometry,
      )
      this.scenes.set(layer, scene)
    }
    return scene
  }

  isClear(escape: PendingPadEscape): boolean {
    const scene = this.sceneForLayer(escape.layer)
    if (escape.existingCompleteConnection)
      return scene.hasExistingCompleteConnection()
    if (escape.existingEgress)
      return scene.existingEgressIsClear(escape.existingEgress)
    if (
      !scene.scene.visible(escape.path[0], escape.path[0]) ||
      !scene.scene.pathVisible(escape.path)
    )
      return false
    const last = escape.path.at(-1)!
    if (escape.ownedCarrier)
      return scene.ownedCarrierIsClear({
        point: last,
        target: escape.ownedCarrier,
      })
    return escape.via
      ? scene.viaLayers(last) !== undefined
      : scene.surfaceExit(last)
  }

  *findEscape(): Generator<void, PendingPadEscape | null> {
    const terminal =
      this.request.connection.pointsToConnect[this.request.terminalIndex]
    for (const layer of terminal.layers ?? [terminal.layer]) {
      const escape = yield* findPendingPadLayerEscape(this.sceneForLayer(layer))
      if (escape) return escape
    }
    return null
  }
}

function escapePath({
  access,
  parent,
  attachments,
  cell,
}: {
  access: GridRoutingAccess
  parent: Int32Array
  attachments: ReadonlyMap<number, Point[]>
  cell: number
}): Point[] {
  const suffix: Point[] = []
  while (!attachments.has(cell)) {
    suffix.push(access.point(cell))
    cell = parent[cell]
  }
  return [...attachments.get(cell)!, ...suffix.reverse()]
}

/** Search the complete declared board domain, using the router's continuous
 * occupancy and endpoint attachments. No pad-radius limit or preselected exit
 * direction restricts legal witnesses. Exhaustion refers to this shared grid
 * domain; grid allocation failures propagate instead of becoming no-access. */
function* findPendingPadLayerEscape(
  scene: PendingPadScene,
): Generator<void, PendingPadEscape | null> {
  const { input } = scene.request
  const terminal = scene.terminal
  if (scene.hasExistingCompleteConnection())
    return {
      path: [terminal],
      layer: terminal.layer,
      existingCompleteConnection: true,
    }
  const existingEgress = scene.existingEgress()
  if (existingEgress)
    return { path: [terminal], layer: terminal.layer, existingEgress }
  yield* scene.prepareOwnedCarrierTargets()
  const directCarrier = scene.ownedCarrier(terminal)
  if (directCarrier && scene.scene.visible(terminal, terminal))
    return {
      path: [terminal],
      layer: terminal.layer,
      ownedCarrier: directCarrier,
    }
  const search = new GridVisibilitySearch(
    scene.scene,
    terminal,
    terminal,
    [],
    0,
    undefined,
    { bounds: input.bounds, allTerminalAttachments: true },
  )
  const access = search.getRoutingAccess()
  search.cancel()
  // Routing access uses occupancy/edge arrays, never A* scores or parents.
  // After cancel releases its lease, borrow those buffers for this flood:
  // Float64 scores hold exact integer cell IDs in the existing grid domain.
  const lease = acquireGridScratch(input, access.cellCount, false)
  try {
    const { parent, best: queue } = lease.scratch
    parent.fill(-1)
    const attachments = new Map(
      access.starts.map((entry) => [entry.id, entry.path]),
    )
    let tail = 0
    for (const cell of attachments.keys()) {
      parent[cell] = cell
      queue[tail++] = cell
    }
    for (let next = 0; next < tail; next++) {
      const cell = queue[next]
      const point = access.point(cell)
      const viaLayers = scene.viaLayers(point)
      const ownedCarrier = scene.ownedCarrier(point)
      if (viaLayers || scene.surfaceExit(point) || ownedCarrier) {
        return {
          path: escapePath({ access, parent, attachments, cell }),
          layer: terminal.layer,
          ...(viaLayers ? { via: { point, layers: viaLayers } } : {}),
          ...(!viaLayers && ownedCarrier ? { ownedCarrier } : {}),
        }
      }
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
          parent[other] >= 0 ||
          access.isBlocked(other) ||
          !access.hardEdgeIsClear(cell, neighbor)
        )
          continue
        parent[other] = cell
        queue[tail++] = other
      }
      if (next % 256 === 0) yield
    }
    return null
  } finally {
    lease.release()
  }
}

/** A through-hole or other flexible terminal may already use more than one
 * physical layer. Preserve access on any declared terminal layer. */
export function* findPendingPadEscape(
  request: PendingPadRequest,
): Generator<void, PendingPadEscape | null> {
  return yield* new PendingPadEscapeCheck(request).findEscape()
}
