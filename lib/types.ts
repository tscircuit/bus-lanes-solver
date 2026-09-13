/** Board-space geometry: right-handed XY, +X right, +Y up; positions and widths in mm. */
export interface Point {
  x: number
  y: number
}
export interface Terminal extends Point {
  layer: string
  pcb_port_id?: string
  pointId?: string
  layers?: string[]
}
export interface Connection {
  name: string
  source_trace_id?: string
  pointsToConnect: Terminal[]
  nominalTraceWidth?: number
  width?: number
}
export interface ImpedanceProfile {
  layer: string
  points: Array<{ traceWidth: number; impedance: number }>
}
export interface Bus {
  busId: string
  name?: string
  connectionNames: string[]
  maxLengthSkew?: number
  traceWidth?: number
  allowedLayers?: string[]
  targetImpedance?: number
  impedanceProfile?: ImpedanceProfile
}
export interface Wire extends Point {
  route_type: "wire"
  layer: string
  width: number
}
export interface Via extends Point {
  route_type: "via"
  from_layer: string
  to_layer: string
  layers?: string[]
  via_diameter?: number
}
export interface Trace {
  type: "pcb_trace"
  pcb_trace_id: string
  connection_name?: string
  source_trace_id?: string
  route: (Wire | Via)[]
}
export interface Obstacle {
  type?: string
  center: Point
  width: number
  height: number
  layers: string[]
  connectedTo: string[]
}
/** Structural SimpleRouteJson boundary; unknown routing primitives are rejected. */
export interface SimpleRouteJson {
  layerCount: number
  minTraceWidth: number
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  connections: Connection[]
  obstacles: Obstacle[]
  traces?: Trace[]
  buses?: Bus[]
  defaultObstacleMargin?: number
  minTraceToPadEdgeClearance?: number
  minBoardEdgeClearance?: number
  outline?: Point[]
  differentialPairs?: Array<{
    connectionNames: [string, string]
    lengthTolerance: number
    traceGap?: number
    maxUncoupledLength?: number
  }>
}
export interface SolverOptions {
  maxLaneIterations?: number
  gridStep?: number
  maxSearchIterations?: number
}
