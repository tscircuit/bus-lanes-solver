import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { PendingPadEscapeCheck, type PendingPadEscape } from "../../lib/pending-pad-escape"
import { PendingPadGeometry } from "../../lib/pending-pad-geometry"
import type { Connection, Obstacle, Point, SimpleRouteJson, Terminal, Trace, Via } from "../../lib/types"

type DrcReport = ReturnType<typeof validateRoutedCopperDrc>
type Box = SimpleRouteJson["bounds"]
type WidthSource = "first-owning-bus" | "nominal" | "legacy" | "minimum"
type NativeField = { componentId: string; rotationRadians: number; bounds: Box }
type ExistingVia = { point: Via; layers: string[]; owners: Set<string>; landMm: number; drillMm: number }
type ExistingWire = { start: Point; end: Point; layer: string; widthMm: number; owners: Set<string> }

export interface PendingTerminalCertificate {
  phaseIndex: number
  connectionName: string
  terminalIndex: number
  pcbPortId?: string
  widthMm: number
  widthSource: WidthSource
  nativeLayers: string[]
  carrierLayers: string[]
  witness: PendingPadEscape | null
  field?: NativeField
  drc?: DrcReport
  /** The generic checker accepts one clearance; independent primitive checks
   * below enforce the separate declared wire and via clearances above it. */
  drcClearanceFloorMm?: number
  issues: string[]
  valid: boolean
}

export interface PendingWitnessCertificateReport {
  qualification: string
  terminalCount: number
  validCount: number
  viaCount: number
  surfaceExitCount: number
  reports: PendingTerminalCertificate[]
}

export interface PendingWitnessAuditRequest {
  input: SimpleRouteJson
  traces: readonly Trace[]
  fixedConnections?: readonly Connection[]
}

export interface PendingWitnessValidationRequest extends PendingWitnessAuditRequest {
  phaseIndex: number
  connection: Connection
  terminalIndex: number
  witness: PendingPadEscape | null
}

const toleranceMm = 1e-8
const qualification = "Each concrete native-terminal access witness is independently checked against the unchanged original pads and the complete accepted current/fixed copper. These individual necessary access conditions do not prove that future nets can be mutually routed. Existing-owned-copper shortcut witnesses are deliberately unsupported by this H3 certificate."

function drain<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

function aliases(connection: Connection): Set<string> {
  return new Set([connection.name, connection.source_trace_id,
    ...connection.pointsToConnect.flatMap(point => [point.pcb_port_id, point.pointId]),
  ].filter((value): value is string => typeof value === "string"))
}

function physicalLayers(layerCount: number): string[] {
  if (!Number.isInteger(layerCount) || layerCount < 1) throw Error("Invalid physical layer count")
  return Array.from({ length: layerCount }, (_, index) => index === 0 ? "top" : index === layerCount - 1 ? "bottom" : `inner${index}`)
}

/** Independent expression of first-owning-bus / nominal / legacy / minimum precedence. */
function futureWidth(input: SimpleRouteJson, connection: Connection): { widthMm: number; widthSource: WidthSource } {
  const firstOwner = input.buses?.find(bus => bus.connectionNames.includes(connection.name))
  if (firstOwner?.traceWidth !== undefined) return { widthMm: firstOwner.traceWidth, widthSource: "first-owning-bus" }
  if (connection.nominalTraceWidth !== undefined) return { widthMm: connection.nominalTraceWidth, widthSource: "nominal" }
  if (connection.width !== undefined) return { widthMm: connection.width, widthSource: "legacy" }
  return { widthMm: input.minTraceWidth, widthSource: "minimum" }
}

function futureCarriers(input: SimpleRouteJson, connection: Connection): string[] {
  return physicalLayers(input.layerCount).filter(layer =>
    (input.allowedLayers === undefined || input.allowedLayers.includes(layer)) &&
    (input.buses ?? []).filter(bus => bus.connectionNames.includes(connection.name))
      .every(bus => bus.allowedLayers === undefined || bus.allowedLayers.includes(layer)),
  )
}

function rotate(point: Point, radians: number): Point {
  const cosine = Math.cos(radians), sine = Math.sin(radians)
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine }
}

function padDistance(point: Point, pad: Obstacle): number {
  const local = rotate({ x: point.x - pad.center.x, y: point.y - pad.center.y }, -(pad.ccwRotationDegrees ?? 0) * Math.PI / 180)
  if (pad.shape === "circle") return Math.max(0, Math.hypot(local.x, local.y) - pad.width / 2)
  return Math.hypot(Math.max(0, Math.abs(local.x) - pad.width / 2), Math.max(0, Math.abs(local.y) - pad.height / 2))
}

function fieldBounds(pads: readonly Obstacle[], radians: number): Box {
  const bounds: Box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  const include = (point: Point) => {
    bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y)
  }
  for (const pad of pads) {
    const center = rotate(pad.center, -radians)
    if (pad.shape === "circle") {
      if (pad.width !== pad.height) throw Error("A circular original pad must declare equal physical dimensions")
      include({ x: center.x - pad.width / 2, y: center.y - pad.width / 2 })
      include({ x: center.x + pad.width / 2, y: center.y + pad.width / 2 })
    } else {
      const angle = (pad.ccwRotationDegrees ?? 0) * Math.PI / 180 - radians
      for (const x of [-pad.width / 2, pad.width / 2]) for (const y of [-pad.height / 2, pad.height / 2]) {
        const corner = rotate({ x, y }, angle)
        include({ x: center.x + corner.x, y: center.y + corner.y })
      }
    }
  }
  return bounds
}

/** Derive the pad field from original obstacle copper only, never routed trunks. */
function nativeField(request: { input: SimpleRouteJson; connection: Connection; terminal: Terminal; layer: string }): NativeField | undefined {
  const owners = aliases(request.connection)
  const pad = request.input.obstacles.find(candidate => candidate.componentId &&
    candidate.layers.includes(request.layer) && candidate.connectedTo.some(owner => owners.has(owner)) &&
    padDistance(request.terminal, candidate) <= toleranceMm)
  if (!pad?.componentId) return undefined
  const pads = request.input.obstacles.filter(candidate => candidate.componentId === pad.componentId && candidate.isNonPlatedHole !== true)
  let rotationRadians = 0, bounds = fieldBounds(pads, 0)
  const area = (box: Box) => (box.maxX - box.minX) * (box.maxY - box.minY)
  const candidates = [...new Set(pads.filter(candidate => candidate.shape !== "circle")
    .map(candidate => (((candidate.ccwRotationDegrees ?? 0) % 90) + 90) % 90))].sort((a, b) => a - b)
  for (const angleDegrees of candidates) {
    const angle = angleDegrees * Math.PI / 180, candidate = fieldBounds(pads, angle)
    if (area(candidate) < area(bounds) - 1e-9) { rotationRadians = angle; bounds = candidate }
  }
  return { componentId: pad.componentId, rotationRadians, bounds }
}

function pointSegment(request: { point: Point; start: Point; end: Point }): number {
  const { point, start, end } = request
  const x = end.x - start.x, y = end.y - start.y, squared = x * x + y * y
  const t = squared ? Math.max(0, Math.min(1, ((point.x - start.x) * x + (point.y - start.y) * y) / squared)) : 0
  return Math.hypot(point.x - start.x - t * x, point.y - start.y - t * y)
}

function orientation(request: { a: Point; b: Point; c: Point }): number {
  return (request.b.x - request.a.x) * (request.c.y - request.a.y) - (request.b.y - request.a.y) * (request.c.x - request.a.x)
}

function segmentDistance(request: { a: Point; b: Point; c: Point; d: Point }): number {
  const { a, b, c, d } = request
  const first = orientation({ a, b, c }), second = orientation({ a, b, c: d })
  const third = orientation({ a: c, b: d, c: a }), fourth = orientation({ a: c, b: d, c: b })
  if (first * second < 0 && third * fourth < 0) return 0
  return Math.min(pointSegment({ point: a, start: c, end: d }), pointSegment({ point: b, start: c, end: d }),
    pointSegment({ point: c, start: a, end: b }), pointSegment({ point: d, start: a, end: b }))
}

function segmentPadDistance({ start, end, pad }: { start: Point; end: Point; pad: Obstacle }): number {
  if (pad.shape === "circle") return Math.max(0,
    pointSegment({ point: pad.center, start, end }) - pad.width / 2)
  const local = (point: Point) => rotate({ x: point.x - pad.center.x, y: point.y - pad.center.y },
    -(pad.ccwRotationDegrees ?? 0) * Math.PI / 180)
  const a = local(start), b = local(end)
  if ([a, b].some(point => Math.abs(point.x) <= pad.width / 2 && Math.abs(point.y) <= pad.height / 2)) return 0
  const corners = [
    { x: -pad.width / 2, y: -pad.height / 2 }, { x: pad.width / 2, y: -pad.height / 2 },
    { x: pad.width / 2, y: pad.height / 2 }, { x: -pad.width / 2, y: pad.height / 2 },
  ]
  return Math.min(...corners.map((c, index) => segmentDistance({ a, b, c, d: corners[(index + 1) % 4] })))
}

function insidePolygon(point: Point, ring: readonly Point[]): boolean {
  let contained = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) contained = !contained
  }
  return contained
}

function boardClear(request: { input: SimpleRouteJson; start: Point; end: Point; radiusMm: number }): boolean {
  const { input, start, end } = request, margin = request.radiusMm + (input.minBoardEdgeClearance ?? 0), box = input.bounds
  if ([start, end].some(point => point.x < box.minX + margin - toleranceMm || point.x > box.maxX - margin + toleranceMm || point.y < box.minY + margin - toleranceMm || point.y > box.maxY - margin + toleranceMm)) return false
  const ring = input.outline
  if (!ring?.length) return true
  return insidePolygon(start, ring) && insidePolygon(end, ring) && ring.every((point, index) =>
    segmentDistance({ a: start, b: end, c: point, d: ring[(index + 1) % ring.length] }) >= margin - toleranceMm)
}

function spanOf(via: Via, physical: string[]): string[] {
  const from = physical.indexOf(via.from_layer), to = physical.indexOf(via.to_layer)
  if (from < 0 || to < 0 || from === to) throw Error("Existing via has invalid physical endpoints")
  const span = via.layers ?? physical.slice(Math.min(from, to), Math.max(from, to) + 1)
  if (!span.length || new Set(span).size !== span.length || !span.includes(via.from_layer) || !span.includes(via.to_layer) || span.some(layer => !physical.includes(layer))) throw Error("Existing via has invalid physical span")
  return span
}

function existingCopper(input: SimpleRouteJson): { vias: ExistingVia[]; wires: ExistingWire[] } {
  const physical = physicalLayers(input.layerCount), vias: ExistingVia[] = [], wires: ExistingWire[] = []
  for (const trace of input.traces ?? []) {
    const owners = new Set([trace.connection_name, trace.source_trace_id].filter((owner): owner is string => !!owner))
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type === "via") vias.push({ point, layers: spanOf(point, physical), owners,
        landMm: point.via_diameter ?? 0.3, drillMm: point.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15 })
      const next = trace.route[index + 1]
      if (!next || (point.route_type === "via" && next.route_type === "via")) continue
      const wire = point.route_type === "wire" ? point : next.route_type === "wire" ? next : undefined
      if (!wire || (point.route_type === "wire" && next.route_type === "wire" && point.layer !== next.layer)) continue
      wires.push({ start: point, end: next, layer: wire.layer, widthMm: wire.width, owners })
    }
  }
  return { vias, wires }
}

/** This guard keeps the same obstacle objects and geometry; it never rewrites tags. */
function assertOriginalRectObstacles(obstacles: Obstacle[]): asserts obstacles is (Obstacle & { type: "rect" })[] {
  if (obstacles.some(obstacle => obstacle.type !== "rect")) throw Error("H3 official DRC certificate requires original rect obstacle tags")
}

function declaredConnections(request: PendingWitnessAuditRequest): Connection[] {
  const declared = [...(request.fixedConnections ?? []), ...request.input.connections,
    ...(request.input.pendingRoutingAccess ?? []).flatMap(group => group.connections)]
  for (const trace of request.traces) {
    if (!trace.connection_name || !declared.some(connection => connection.name === trace.connection_name)) throw Error("Every accepted trace must have its original declared connection; supply fixedConnections")
  }
  const futureOwners = new Set((request.input.pendingRoutingAccess ?? []).flatMap(group => group.connections.flatMap(connection => [...aliases(connection)])))
  if (request.traces.some(trace => [trace.connection_name, trace.source_trace_id].some(owner => owner !== undefined && futureOwners.has(owner)))) throw Error("This H3 certificate requires disjoint current and future copper ownership")
  return declared
}

function phaseInput(request: PendingWitnessAuditRequest, phaseIndex: number): SimpleRouteJson {
  const intent = request.input.pendingRoutingAccess?.[phaseIndex]
  if (!intent) throw Error("Pending phase does not exist")
  // Future dimensions and clearances come exclusively from that phase.
  return { ...intent, layerCount: request.input.layerCount, obstacles: request.input.obstacles, traces: [...request.traces] }
}

export function validatePendingTerminalWitness(request: PendingWitnessValidationRequest): PendingTerminalCertificate {
  const input = phaseInput(request, request.phaseIndex), { connection, terminalIndex, witness } = request
  const terminal = connection.pointsToConnect[terminalIndex]
  if (!terminal) throw Error("Pending terminal does not exist")
  const { widthMm, widthSource } = futureWidth(input, connection)
  const nativeLayers = terminal.layers ?? [terminal.layer], carrierLayers = futureCarriers(input, connection)
  const issues = new Set<string>()
  const report: PendingTerminalCertificate = { phaseIndex: request.phaseIndex, connectionName: connection.name, terminalIndex,
    pcbPortId: terminal.pcb_port_id, widthMm, widthSource, nativeLayers: [...nativeLayers], carrierLayers, witness, issues: [], valid: false }
  const declared = declaredConnections(request)
  assertOriginalRectObstacles(input.obstacles)
  if (!(widthMm > 0) || !Number.isFinite(widthMm)) issues.add("invalid-future-width")
  if (!witness) { report.issues = ["no-witness"]; return report }
  if (witness.ownedCarrier || witness.existingEgress || witness.existingCompleteConnection) issues.add("unsupported-owned-copper-shortcut")
  if (new Set(nativeLayers).size !== nativeLayers.length || nativeLayers.some(layer => !physicalLayers(input.layerCount).includes(layer))) issues.add("invalid-declared-native-layers")
  if (!nativeLayers.includes(witness.layer) || !physicalLayers(input.layerCount).includes(witness.layer)) issues.add("witness-layer-is-not-native")
  if (!witness.path.length || witness.path[0].x !== terminal.x || witness.path[0].y !== terminal.y) issues.add("witness-does-not-start-at-exact-terminal")
  if (witness.path.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) issues.add("nonfinite-witness")
  const end = witness.path.at(-1)
  if (!end) { report.issues = [...issues, "empty-witness-path"]; return report }
  report.field = nativeField({ input, connection, terminal, layer: witness.layer })
  if (!report.field) issues.add("no-original-native-package-field")
  const owners = aliases(connection), copper = existingCopper(input)
  const foreign = (other: ReadonlySet<string>) => ![...other].some(owner => owners.has(owner))
  const ordinaryClearance = input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const viaPadClearance = input.minViaEdgeToPadEdgeClearance ?? input.minPadEdgeToPadEdgeClearance ?? ordinaryClearance
  const wirePadClearance = (pad: Obstacle) => pad.isNonPlatedHole === true
    ? input.minTraceToHoleEdgeClearance ?? ordinaryClearance
    : ordinaryClearance
  const wirePointIsClear = (point: Point, layer: string) =>
    boardClear({ input, start: point, end: point, radiusMm: widthMm / 2 }) &&
    input.obstacles.every(pad => !pad.layers.includes(layer) || pad.connectedTo.some(owner => owners.has(owner)) ||
      padDistance(point, pad) >= widthMm / 2 + wirePadClearance(pad) - toleranceMm) &&
    copper.wires.every(wire => wire.layer !== layer || !foreign(wire.owners) ||
      pointSegment({ point, start: wire.start, end: wire.end }) >= widthMm / 2 + wire.widthMm / 2 + ordinaryClearance - toleranceMm) &&
    copper.vias.every(via => !via.layers.includes(layer) || !foreign(via.owners) ||
      Math.hypot(point.x - via.point.x, point.y - via.point.y) >= widthMm / 2 + via.landMm / 2 + ordinaryClearance - toleranceMm)
  if (!wirePointIsClear(witness.path[0], witness.layer)) issues.add("native-start-future-width-clearance")
  for (const [index, start] of witness.path.entries()) {
    const finish = witness.path[index + 1] ?? start
    if (!boardClear({ input, start, end: finish, radiusMm: widthMm / 2 })) issues.add("future-wire-board-clearance")
    for (const pad of input.obstacles) if (pad.layers.includes(witness.layer) && !pad.connectedTo.some(owner => owners.has(owner)) &&
      segmentPadDistance({ start, end: finish, pad }) < widthMm / 2 + wirePadClearance(pad) - toleranceMm) issues.add("future-wire-to-existing-pad")
    for (const wire of copper.wires) if (foreign(wire.owners) && wire.layer === witness.layer &&
      segmentDistance({ a: start, b: finish, c: wire.start, d: wire.end }) < widthMm / 2 + wire.widthMm / 2 + ordinaryClearance - toleranceMm) issues.add("future-wire-to-existing-wire")
    for (const via of copper.vias) if (foreign(via.owners) && via.layers.includes(witness.layer) &&
      pointSegment({ point: via.point, start, end: finish }) < widthMm / 2 + via.landMm / 2 + ordinaryClearance - toleranceMm) issues.add("future-wire-to-existing-via-land")
  }
  let target: string | undefined
  const landMm = input.minViaPadDiameter ?? 0.3, drillMm = input.minViaHoleDiameter ?? 0.15
  if (witness.via) {
    const at = witness.via.point, physical = physicalLayers(input.layerCount), span = witness.via.layers
    if (at.x !== end.x || at.y !== end.y) issues.add("via-is-not-at-exact-path-end")
    if (!(drillMm > 0) || !(landMm > 0) || drillMm > landMm || !Number.isFinite(landMm + drillMm)) issues.add("invalid-new-via-dimensions")
    target = carrierLayers.find(layer => layer !== witness.layer && span.includes(layer) &&
      (() => { const from = physical.indexOf(witness.layer), to = physical.indexOf(layer)
        const expected = input.allowBlindAndBuriedVias ? physical.slice(Math.min(from, to), Math.max(from, to) + 1) : physical
        return expected.length === span.length && expected.every((value, index) => value === span[index]) })())
    if (!target) issues.add("new-via-span-or-carrier-policy")
    if (target && !wirePointIsClear(at, target)) issues.add("future-carrier-handoff-width-clearance")
    if (!boardClear({ input, start: at, end: at, radiusMm: Math.max(landMm, drillMm) / 2 })) issues.add("future-via-board-clearance")
    const padClearance = viaPadClearance
    for (const pad of input.obstacles) if (pad.layers.some(layer => span.includes(layer))) {
      const distanceMm = padDistance(at, pad)
      if (!input.allowViaInPad && distanceMm < drillMm / 2 - toleranceMm) issues.add("forbidden-new-via-in-pad")
      if (!pad.connectedTo.some(owner => owners.has(owner)) && distanceMm < landMm / 2 + (pad.isNonPlatedHole === true ? 0 : padClearance) - toleranceMm) issues.add("future-via-specific-pad-clearance")
    }
    const drillClearance = input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
    for (const via of copper.vias) if (via.layers.some(layer => span.includes(layer))) {
      const distanceMm = Math.hypot(at.x - via.point.x, at.y - via.point.y)
      if (distanceMm < drillMm / 2 + via.drillMm / 2 + drillClearance - toleranceMm) issues.add("future-drill-to-existing-drill")
      if (foreign(via.owners) && distanceMm < landMm / 2 + via.landMm / 2 + padClearance - toleranceMm) issues.add("future-via-to-existing-via-land")
    }
    for (const wire of copper.wires) if (foreign(wire.owners) && span.includes(wire.layer)) {
      const distanceMm = pointSegment({ point: at, start: wire.start, end: wire.end })
      if (distanceMm < landMm / 2 + wire.widthMm / 2 + ordinaryClearance - toleranceMm) issues.add("future-via-land-to-existing-wire")
    }
  } else {
    if (!carrierLayers.includes(witness.layer)) issues.add("surface-exit-outside-carrier-policy")
    if (report.field) {
      const local = rotate(end, -report.field.rotationRadians), box = report.field.bounds, margin = widthMm / 2
      if (!(local.x < box.minX - margin - toleranceMm || local.x > box.maxX + margin + toleranceMm || local.y < box.minY - margin - toleranceMm || local.y > box.maxY + margin + toleranceMm)) issues.add("surface-end-is-not-outside-original-pad-field")
    }
  }
  // A malformed or shortcut certificate cannot become a fabricated probe.
  if (!issues.has("unsupported-owned-copper-shortcut") && !issues.has("nonfinite-witness") && !issues.has("new-via-span-or-carrier-policy")) {
    const existingIds = new Set(request.traces.map(trace => trace.pcb_trace_id))
    let id = `pending_certificate_${request.phaseIndex}_${connection.name}_${terminalIndex}`
    while (existingIds.has(id)) id += "_"
    const probe: Trace = { type: "pcb_trace", pcb_trace_id: id, connection_name: connection.name, source_trace_id: connection.source_trace_id,
      route: witness.path.map(point => ({ ...point, route_type: "wire", layer: witness.layer, width: widthMm })) }
    if (witness.via && target) probe.route.push({ ...witness.via.point, route_type: "via", from_layer: witness.layer, to_layer: target,
      layers: [...witness.via.layers], via_diameter: landMm, via_hole_diameter: drillMm },
      { ...witness.via.point, route_type: "wire", layer: target, width: widthMm })
    const ownedTraces = [...request.traces, probe].map(trace => {
      if (!trace.connection_name) throw Error("Trace connection declaration is missing")
      return { ...trace, connection_name: trace.connection_name }
    })
    const inputSrj = { ...input, connections: declared, obstacles: input.obstacles, traces: ownedTraces.slice(0, -1) }
    // This checker exposes one common clearance rather than separate pad/via
    // policies. Never strengthen an explicit smaller via rule through that API:
    // use their shared floor, then require every independent exact check above.
    report.drcClearanceFloorMm = Math.min(ordinaryClearance, viaPadClearance,
      ...input.obstacles.filter(pad => pad.isNonPlatedHole === true).map(() => input.minTraceToHoleEdgeClearance ?? ordinaryClearance))
    report.drc = validateRoutedCopperDrc({ inputSrj, routedSrj: { ...inputSrj, traces: ownedTraces }, clearance: report.drcClearanceFloorMm,
      allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false })
    if (!report.drc.valid) issues.add("official-fanout-probe-drc")
  }
  report.issues = [...issues]
  report.valid = issues.size === 0 && report.drc?.valid === true
  return report
}

export function auditPendingWitnesses(request: PendingWitnessAuditRequest): PendingWitnessCertificateReport {
  declaredConnections(request)
  const reports: PendingTerminalCertificate[] = []
  for (const [phaseIndex, intent] of (request.input.pendingRoutingAccess ?? []).entries()) {
    const input = phaseInput(request, phaseIndex), geometry = new PendingPadGeometry(input)
    for (const connection of intent.connections) for (const terminalIndex of connection.pointsToConnect.keys()) {
      const witness = drain(new PendingPadEscapeCheck({ input, connection, terminalIndex }, geometry).findEscape())
      reports.push(validatePendingTerminalWitness({ ...request, phaseIndex, connection, terminalIndex, witness }))
    }
  }
  return { qualification, terminalCount: reports.length, validCount: reports.filter(report => report.valid).length,
    viaCount: reports.filter(report => report.witness?.via).length,
    surfaceExitCount: reports.filter(report => report.witness && !report.witness.via && !report.witness.ownedCarrier && !report.witness.existingEgress && !report.witness.existingCompleteConnection).length,
    reports }
}
