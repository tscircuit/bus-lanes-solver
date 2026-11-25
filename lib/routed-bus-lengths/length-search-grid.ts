import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { CopperIndex } from "../copper-index"
import { getRouteAnchors, type RouteAnchor } from "./get-route-anchors"
import { signalWidth } from "../repair-bus-dogbones"
import { clearanceToCopper, fixedCopper, VectorScene } from "../vector-scene"
import type { Point, SimpleRouteJson, Trace, Via, Wire } from "../types"
import type { RoutedLengthWindow } from "./get-routed-length-windows"

export class LengthSearchGrid {
  readonly layers: string[]
  readonly viaLayers: string[]
  readonly width: number
  readonly viaDiameter: number
  readonly viaHoleDiameter: number
  readonly viaCost: number
  readonly columns: number
  readonly rows: number
  readonly area: number
  readonly size: number
  readonly scenes: VectorScene[]
  readonly blocked: Uint8Array
  readonly viaBlocked: Uint8Array
  private readonly nearCopper: Uint8Array
  private readonly checked: Uint8Array
  private readonly clear: Uint8Array
  readonly offsets: number[]
  readonly start: Point
  readonly end: Point
  readonly center: Point
  readonly origin: Point
  readonly anchors: RouteAnchor[]
  readonly lengthMm: number
  readonly firstCollision: number
  readonly lastCollision: number

  constructor(
    readonly params: {
      input: SimpleRouteJson
      window: RoutedLengthWindow
      trace: Trace
      obstacles: Trace[]
      step: number
    },
  ) {
    const { input, window, trace, obstacles, step } = params
    this.layers = window.allowedLayers
    this.viaLayers = getCopperLayerNames(input.layerCount)
    this.width = signalWidth(input, window.connection)
    this.viaDiameter = input.minViaPadDiameter ?? 0.6
    this.viaHoleDiameter = input.minViaHoleDiameter ?? 0.3
    this.viaCost = this.viaDiameter
    this.start = trace.route[0]
    this.end = trace.route.at(-1)!
    this.center = {
      x: (this.start.x + this.end.x) / 2,
      y: (this.start.y + this.end.y) / 2,
    }
    // No point on a route of length L can lie outside an L-wide square
    // centered between its terminals. Include the original off-grid endpoints.
    const extent = window.targetMm + 1
    const edgeMargin = this.width / 2 + (input.minBoardEdgeClearance ?? 0)
    this.origin = {
      x:
        Math.ceil(
          (Math.max(
            input.bounds.minX + edgeMargin,
            this.center.x - extent / 2,
          ) -
            step / 2) /
            step,
        ) *
          step +
        step / 2,
      y:
        Math.ceil(
          (Math.max(
            input.bounds.minY + edgeMargin,
            this.center.y - extent / 2,
          ) -
            step / 2) /
            step,
        ) *
          step +
        step / 2,
    }
    this.columns = Math.max(
      0,
      Math.ceil(
        (Math.min(input.bounds.maxX - edgeMargin, this.center.x + extent / 2) -
          this.origin.x) /
          step,
      ),
    )
    this.rows = Math.max(
      0,
      Math.ceil(
        (Math.min(input.bounds.maxY - edgeMargin, this.center.y + extent / 2) -
          this.origin.y) /
          step,
      ),
    )
    this.area = this.columns * this.rows
    this.size = this.area * this.layers.length
    if (this.size > 8_000_000)
      throw new Error("Bus length search exceeds the grid cell budget")
    this.blocked = new Uint8Array(this.size)
    this.nearCopper = new Uint8Array(this.size)
    this.viaBlocked = new Uint8Array(this.area)
    this.checked = new Uint8Array(this.size)
    this.clear = new Uint8Array(this.size)
    const n = this.columns
    this.offsets = [1, -1, n, -n, n + 1, -n - 1, n - 1, -n + 1]
    const copper = fixedCopper({ ...input, traces: obstacles })
    this.scenes = this.layers.map(
      (layer) =>
        new VectorScene(
          input,
          {
            ...window.connection,
            pointsToConnect: window.connection.pointsToConnect.map((p) => ({
              ...p,
              layer,
            })),
          },
          this.width,
          copper,
        ),
    )
    const copperIndex = new CopperIndex(copper)
    const clearance =
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
    const viaMargin =
      this.viaDiameter / 2 +
      Math.max(clearance, input.minViaEdgeToPadEdgeClearance ?? clearance)
    const wireMargin = this.width / 2 + clearance
    const edgeSearchRadius = step * Math.SQRT1_2 + 1e-8
    for (const obstacle of copper) {
      const layer = this.layers.indexOf(obstacle.layer)
      const own = obstacle.owners.some((owner) =>
        this.scenes[0]?.owners.has(owner),
      )
      const bounds = obstacle.rect ?? {
        minX: Math.min(obstacle.a.x, obstacle.b.x) - obstacle.radius,
        minY: Math.min(obstacle.a.y, obstacle.b.y) - obstacle.radius,
        maxX: Math.max(obstacle.a.x, obstacle.b.x) + obstacle.radius,
        maxY: Math.max(obstacle.a.y, obstacle.b.y) + obstacle.radius,
      }
      const margin = Math.max(viaMargin, wireMargin + edgeSearchRadius) + 1e-5
      const left = Math.max(
        0,
        Math.ceil((bounds.minX - margin - this.origin.x) / step),
      )
      const right = Math.min(
        this.columns - 1,
        Math.floor((bounds.maxX + margin - this.origin.x) / step),
      )
      const bottom = Math.max(
        0,
        Math.ceil((bounds.minY - margin - this.origin.y) / step),
      )
      const top = Math.min(
        this.rows - 1,
        Math.floor((bounds.maxY + margin - this.origin.y) / step),
      )
      for (let y = bottom; y <= top; y++)
        for (let x = left; x <= right; x++) {
          const cell = y * this.columns + x
          const point = this.point(cell)
          const gap = clearanceToCopper(point, point, obstacle)
          if (gap < viaMargin - 1e-8) this.viaBlocked[cell] = 1
          if (layer < 0 || own) continue
          const id = layer * this.area + cell
          if (gap < wireMargin + edgeSearchRadius) this.nearCopper[id] = 1
          if (gap < wireMargin - 1e-8) this.blocked[id] = 1
        }
    }
    const retained = getRouteAnchors({
      trace,
      layers: this.layers,
      viaLayers: this.viaLayers,
      scenes: this.scenes,
      copperIndex,
      viaMargin,
    })
    this.anchors = retained.anchors
    this.firstCollision = retained.firstCollision
    this.lastCollision = retained.lastCollision
    this.lengthMm = retained.lengthMm
  }

  point(id: number): Point {
    const cell = id % this.area
    return {
      x: this.origin.x + (cell % this.columns) * this.params.step,
      y: this.origin.y + Math.floor(cell / this.columns) * this.params.step,
    }
  }

  edgeIsClear(id: number, direction: number) {
    const neighbor = id + this.offsets[direction]
    if (
      !this.nearCopper[id] &&
      !this.nearCopper[neighbor] &&
      !this.params.input.outline?.length
    )
      return true
    const bit = 1 << direction,
      opposite = 1 << (direction ^ 1)
    if (!(this.checked[id] & bit)) {
      this.checked[id] |= bit
      this.checked[neighbor] |= opposite
      if (
        this.scenes[Math.floor(id / this.area)].visible(
          this.point(id),
          this.point(neighbor),
        )
      ) {
        this.clear[id] |= bit
        this.clear[neighbor] |= opposite
      }
    }
    return Boolean(this.clear[id] & bit)
  }

  wire(point: Point, layer: string): Wire {
    return {
      route_type: "wire",
      x: point.x,
      y: point.y,
      width: this.width,
      layer,
    }
  }
  via(point: Point, { from, to }: { from: string; to: string }): Via {
    return {
      route_type: "via",
      x: point.x,
      y: point.y,
      from_layer: from,
      to_layer: to,
      layers: this.viaLayers,
      via_diameter: this.viaDiameter,
      via_hole_diameter: this.viaHoleDiameter,
    }
  }
}
