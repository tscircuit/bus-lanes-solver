import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { getPackagePadFrame, type PackagePadFrame } from "./package-pad-frame"
import { packageApproachRegions } from "./package-approach-regions"
import { PendingOwnedCarrierAccess } from "./pending-owned-carrier-access"
import { PendingCopperOwnership } from "./pending-copper-ownership"
import { pendingViaDimensions } from "./pending-via-dimensions"
import type { Connection, Obstacle, Point, SimpleRouteJson, Via } from "./types"
import { fixedCopper, VectorScene, type Copper } from "./vector-scene"

type ComponentId = string

const capturedInputFields = [
  "layerCount",
  "minTraceWidth",
  "minViaPadDiameter",
  "minViaHoleDiameter",
  "minViaHoleEdgeToViaHoleEdgeClearance",
  "minViaEdgeToPadEdgeClearance",
  "minTraceToHoleEdgeClearance",
  "minPlatedHoleDrillEdgeToDrillEdgeClearance",
  "minPadEdgeToPadEdgeClearance",
  "allowViaInPad",
  "allowBlindAndBuriedVias",
  "defaultObstacleMargin",
  "minTraceToPadEdgeClearance",
  "minBoardEdgeClearance",
  "bounds",
  "outline",
  "obstacles",
  "traces",
  "allowedLayers",
  "buses",
  "connections",
  "differentialPairs",
  "pendingRoutingAccess",
] as const satisfies readonly (keyof SimpleRouteJson)[]

function isViaPad(shape: Copper, viaPoints: ReadonlySet<Point>): boolean {
  return shape.a === shape.b && viaPoints.has(shape.a)
}

/** Physical copper and package metadata for one immutable candidate union.
 * Width, terminal ownership, and native-layer filtering remain in each scene.
 * Callers own the union lease: this context must not survive its input changing.
 * Obstacles and captured trace geometry are immutable within that lease. */
export class PendingPadGeometry {
  readonly physical: string[]
  readonly copper: Copper[]
  readonly traceCopper: Copper[]
  readonly traceSceneCopper: Copper[]
  readonly padCopper: Copper[]
  readonly wireCopper: Copper[]
  readonly padsAndVias: Copper[]
  readonly oldVias: Via[]
  readonly viaDiameter: number
  readonly holeDiameter: number
  readonly landingInput: SimpleRouteJson
  readonly componentPads: Obstacle[]
  readonly frameByComponent: ReadonlyMap<ComponentId, PackagePadFrame>
  private readonly captured: SimpleRouteJson
  private readonly ownedAccess = new Map<
    Connection,
    PendingOwnedCarrierAccess
  >()
  private readonly wireClearances = new Map<Copper, number>()
  private readonly viaClearances = new Map<Copper, number>()

  constructor(
    private readonly input: SimpleRouteJson,
    readonly ownership = new PendingCopperOwnership(input),
  ) {
    ownership.assertMatches(input)
    this.captured = { ...input }
    this.physical = getCopperLayerNames(input.layerCount)
    const padClearance =
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
    const hasNonPlatedHoles = input.obstacles.some(
      (obstacle) => obstacle.isNonPlatedHole === true,
    )
    const padInput = { ...input, traces: [] }
    this.padCopper = hasNonPlatedHoles
      ? input.obstacles.flatMap((obstacle) => {
          const shapes = fixedCopper({ ...padInput, obstacles: [obstacle] })
          if (obstacle.isNonPlatedHole === true)
            for (const shape of shapes) {
              // Keep explicit source provenance, even if unrelated pads reuse the
              // same Point object. Neither coordinates nor allocation imply class.
              this.wireClearances.set(
                shape,
                input.minTraceToHoleEdgeClearance ?? padClearance,
              )
              // Preserve physical-hole exclusion for via land, without applying a
              // trace-only or SMT-pad-only positive clearance to that other class.
              this.viaClearances.set(shape, 0)
            }
          return shapes
        })
      : fixedCopper(padInput)
    const dimensions = pendingViaDimensions(input)
    this.viaDiameter = dimensions.padDiameter
    this.holeDiameter = dimensions.holeDiameter
    this.oldVias = (input.traces ?? []).flatMap((trace) =>
      trace.route.filter((point): point is Via => point.route_type === "via"),
    )
    const viaPoints = new Set<Point>(this.oldVias)
    this.traceCopper = fixedCopper({ ...input, obstacles: [] })
    this.copper = [...this.padCopper, ...this.traceCopper]
    this.traceSceneCopper = this.copper
    this.wireCopper = this.traceCopper.filter(
      (shape) => !isViaPad(shape, viaPoints),
    )
    this.padsAndVias = [
      ...this.padCopper,
      ...this.traceCopper.filter((shape) => isViaPad(shape, viaPoints)),
    ]
    this.landingInput = {
      ...input,
      // The via-specific declaration overrides the generic pad rule, including
      // an explicit zero. A routing phase must not strengthen declared SRJ
      // fabrication rules by combining independent clearances with MAX.
      minTraceToPadEdgeClearance:
        input.minViaEdgeToPadEdgeClearance ??
        input.minPadEdgeToPadEdgeClearance ??
        input.minTraceToPadEdgeClearance ??
        input.defaultObstacleMargin ??
        0.075,
    }
    const packageInput = hasNonPlatedHoles
      ? {
          ...input,
          obstacles: input.obstacles.filter(
            (obstacle) => obstacle.isNonPlatedHole !== true,
          ),
        }
      : input
    this.componentPads = packageInput.obstacles.filter((pad) => pad.componentId)
    const components = new Map<ComponentId, Obstacle[]>()
    for (const pad of this.componentPads) {
      const componentId = pad.componentId!
      const pads = components.get(componentId) ?? []
      pads.push(pad)
      components.set(componentId, pads)
    }
    const regions = packageApproachRegions(packageInput, 0)
    const frames = new Map<ComponentId, PackagePadFrame>()
    for (const [index, [componentId, pads]] of [...components].entries())
      frames.set(componentId, getPackagePadFrame(pads, regions[index].pads))
    this.frameByComponent = frames
  }

  /** Reuse physical owned topology only within this immutable union lease.
   * Terminal frames and future-width carrier targets remain scene-local. */
  ownedCarrierAccess(connection: Connection): PendingOwnedCarrierAccess {
    this.assertMatches(this.input)
    let access = this.ownedAccess.get(connection)
    if (!access) {
      access = new PendingOwnedCarrierAccess({
        input: this.input,
        connection,
        ownedCopper: this.copper,
        ownedTraceCopper: this.traceCopper,
        ownedVias: this.oldVias,
        owners: this.ownership.owners(connection),
      })
      this.ownedAccess.set(connection, access)
    }
    return access
  }

  createScene(request: {
    input?: SimpleRouteJson
    connection: Connection
    width: number
    copper: Copper[]
    kind?: "wire" | "via-land"
  }): VectorScene {
    this.assertMatches(this.input)
    const input = request.input ?? this.input
    this.ownership.assertMatches(input)
    return VectorScene.withOwnership({
      input,
      connection: request.connection,
      width: request.width,
      copper: request.copper,
      owners: this.ownership.owners(request.connection),
      clearances: this.wireClearances.size
        ? request.kind === "via-land"
          ? this.viaClearances
          : this.wireClearances
        : undefined,
    })
  }

  /** Constant-size identity/rule validation. Copper was prepared once;
   * serializing it here would repeat the terminal-times-board preparation. */
  assertMatches(input: SimpleRouteJson): void {
    if (input !== this.input)
      throw Error("Pending pad geometry belongs to a different input")
    for (const field of capturedInputFields)
      if (input[field] !== this.captured[field])
        throw Error(`Pending pad geometry input changed: ${field}`)
  }
}
