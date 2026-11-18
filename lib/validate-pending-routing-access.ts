import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { boardOutlineError } from "./board-outline"
import { effectiveCarrierLayers } from "./effective-carrier-layers"
import { pendingViaDimensions } from "./pending-via-dimensions"
import type { PendingRoutingAccess, SimpleRouteJson } from "./types"

export class InvalidPendingRoutingAccess extends Error {
  readonly failureCode = "invalid_pending_routing_access"

  constructor(message: string) {
    super(`Invalid pending routing access: ${message}`)
    this.name = "InvalidPendingRoutingAccess"
  }
}

const clearanceFields = [
  "defaultObstacleMargin",
  "minTraceToPadEdgeClearance",
  "minTraceToHoleEdgeClearance",
  "minViaEdgeToPadEdgeClearance",
  "minViaHoleEdgeToViaHoleEdgeClearance",
  "minPlatedHoleDrillEdgeToDrillEdgeClearance",
  "minPadEdgeToPadEdgeClearance",
  "minBoardEdgeClearance",
] as const

function fail(path: string, requirement: string): never {
  throw new InvalidPendingRoutingAccess(`${path} ${requirement}`)
}

function positive(value: number, path: string): void {
  if (!Number.isFinite(value) || value <= 0)
    fail(path, "must be a positive finite number")
}

function layers({
  value,
  physical,
  path,
  allowEmpty = false,
}: {
  value: string[] | undefined
  physical: readonly string[]
  path: string
  allowEmpty?: boolean
}): void {
  if (value === undefined) return
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0))
    fail(path, "must be a nonempty array of physical copper layers")
  if (value.some((layer) => !physical.includes(layer)))
    fail(path, "contains a layer outside the physical stack")
}

function validateGroup({
  intent,
  physical,
  layerCount,
  path,
}: {
  intent: PendingRoutingAccess
  physical: readonly string[]
  layerCount: number
  path: string
}): void {
  if (!intent || typeof intent !== "object") fail(path, "must be an object")
  positive(intent.minTraceWidth, `${path}.minTraceWidth`)
  for (const field of ["minViaPadDiameter", "minViaHoleDiameter"] as const) {
    const value = intent[field]
    if (value !== undefined) positive(value, `${path}.${field}`)
  }
  const dimensions = pendingViaDimensions(intent)
  if (dimensions.holeDiameter > dimensions.padDiameter)
    fail(path, "has a via drill larger than its copper land")
  for (const field of clearanceFields) {
    const value = intent[field]
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      fail(`${path}.${field}`, "must be a nonnegative finite number")
  }
  for (const field of ["allowViaInPad", "allowBlindAndBuriedVias"] as const) {
    if (intent[field] !== undefined && typeof intent[field] !== "boolean")
      fail(`${path}.${field}`, "must be a boolean")
  }
  const bounds = intent.bounds
  if (
    !bounds ||
    ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(
      Number.isFinite,
    ) ||
    bounds.minX >= bounds.maxX ||
    bounds.minY >= bounds.maxY
  )
    fail(`${path}.bounds`, "must define a finite, positive-area rectangle")
  if (intent.outline !== undefined) {
    if (
      !Array.isArray(intent.outline) ||
      intent.outline.some(
        (point) =>
          !point || !Number.isFinite(point.x) || !Number.isFinite(point.y),
      )
    )
      fail(`${path}.outline`, "must contain finite board-world points")
    const error = boardOutlineError(intent.outline)
    if (error) fail(`${path}.outline`, error)
  }
  layers({
    value: intent.allowedLayers,
    physical,
    path: `${path}.allowedLayers`,
  })
  if (!Array.isArray(intent.connections))
    fail(`${path}.connections`, "must be an array")
  const names = new Set<string>()
  for (const [index, connection] of intent.connections.entries()) {
    const connectionPath = `${path}.connections[${index}]`
    if (!connection || typeof connection !== "object")
      fail(connectionPath, "must be an object")
    if (typeof connection.name !== "string" || !connection.name.length)
      fail(`${connectionPath}.name`, "must be a nonempty string")
    if (names.has(connection.name))
      fail(`${connectionPath}.name`, "duplicates another future connection")
    names.add(connection.name)
    for (const field of [
      "source_trace_id",
      "netConnectionName",
      "rootConnectionName",
    ] as const)
      if (
        connection[field] !== undefined &&
        typeof connection[field] !== "string"
      )
        fail(`${connectionPath}.${field}`, "must be a string")
    for (const field of ["nominalTraceWidth", "width"] as const) {
      const value = connection[field]
      if (value !== undefined) positive(value, `${connectionPath}.${field}`)
    }
    if (
      !Array.isArray(connection.pointsToConnect) ||
      !connection.pointsToConnect.length
    )
      fail(`${connectionPath}.pointsToConnect`, "must contain native terminals")
    for (const [pointIndex, point] of connection.pointsToConnect.entries()) {
      const pointPath = `${connectionPath}.pointsToConnect[${pointIndex}]`
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        fail(pointPath, "must be a finite board-world position")
      if (!physical.includes(point.layer))
        fail(`${pointPath}.layer`, "must be in the physical stack")
      layers({ value: point.layers, physical, path: `${pointPath}.layers` })
      if (point.layers && !point.layers.includes(point.layer))
        fail(`${pointPath}.layers`, "must include the native primary layer")
      for (const field of ["pcb_port_id", "pointId"] as const) {
        if (point[field] !== undefined && typeof point[field] !== "string")
          fail(`${pointPath}.${field}`, "must be a string")
      }
    }
  }
  if (intent.buses !== undefined && !Array.isArray(intent.buses))
    fail(`${path}.buses`, "must be an array")
  for (const [index, bus] of (intent.buses ?? []).entries()) {
    const busPath = `${path}.buses[${index}]`
    if (!bus || typeof bus !== "object") fail(busPath, "must be an object")
    if (typeof bus.busId !== "string" || !bus.busId.length)
      fail(`${busPath}.busId`, "must be a nonempty string")
    if (
      !Array.isArray(bus.connectionNames) ||
      bus.connectionNames.some((name) => !names.has(name))
    )
      fail(
        `${busPath}.connectionNames`,
        "must name declared future connections",
      )
    if (bus.traceWidth !== undefined)
      positive(bus.traceWidth, `${busPath}.traceWidth`)
    layers({
      value: bus.allowedLayers,
      physical,
      path: `${busPath}.allowedLayers`,
    })
    layers({
      value: bus.preferredLayers,
      physical,
      path: `${busPath}.preferredLayers`,
      allowEmpty: true,
    })
    if (
      bus.preferredLayer !== undefined &&
      !physical.includes(bus.preferredLayer)
    )
      fail(`${busPath}.preferredLayer`, "must be in the physical stack")
  }
  const future: SimpleRouteJson = { ...intent, layerCount, obstacles: [] }
  for (const connection of intent.connections) {
    if (!effectiveCarrierLayers(future, connection).length)
      fail(path, "contains a future connection without an allowed carrier")
  }
}

/** Invalid intent is not a pre-existing unreachable terminal. Validate before
 * computing baseline reachability so malformed rules cannot erase obligations.
 * Matching feasibility belongs to the future phase, not this physical contract.
 */
export function validatePendingRoutingAccess(input: SimpleRouteJson): void {
  const intents = input.pendingRoutingAccess
  if (intents === undefined) return
  if (!Array.isArray(intents)) fail("pendingRoutingAccess", "must be an array")
  if (!intents.length) return
  if (!Number.isInteger(input.layerCount) || input.layerCount < 1)
    fail("layerCount", "must be a positive integer")
  const physical = getCopperLayerNames(input.layerCount)
  for (const [index, intent] of intents.entries())
    validateGroup({
      intent,
      physical,
      layerCount: input.layerCount,
      path: `pendingRoutingAccess[${index}]`,
    })
}
