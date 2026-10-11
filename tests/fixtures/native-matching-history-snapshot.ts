import { CopperConflictIndex } from "../../lib/copper-conflict-index"
import { fixedCopper } from "../../lib/vector-scene"
import {
  nativeMatchingHistoryOptions,
  type compileNativeMatchingHistoryFixture,
  type runNativeMatchingHistoryFixture,
} from "./native-matching-history"

type Fixture = Pick<
  Awaited<ReturnType<typeof compileNativeMatchingHistoryFixture>>,
  "input" | "signalNames"
>
type Result = ReturnType<typeof runNativeMatchingHistoryFixture>

export function nativeMatchingHistorySvg(
  { input, signalNames }: Fixture,
  result: Result,
) {
  const accepted = result.traces !== null
  if (!result.complete || accepted !== result.validation.valid)
    throw Error("Unexpected or incomplete fixture result")
  if (
    !accepted &&
    (result.stages.length !== 7 ||
      !result.stages.every((stage) => stage.collisions === 1) ||
      result.validation.issues.length !== 1 ||
      result.validation.issues[0].code !== "different-net-trace-clearance")
  )
    throw Error("Expected the single actual rejected-copper conflict")

  const colors = [
    "#2563eb",
    "#9333ea",
    "#0f766e",
    "#b45309",
    "#db2777",
    "#475569",
  ]
  const color = (name: string) => colors[Number(signalNames[name].slice(1))]
  const copper = result.diagnosticTraces.map((trace) =>
    fixedCopper({ ...input, obstacles: [], traces: [trace] }),
  )
  const conflicts = new CopperConflictIndex()
  const highlights = copper.flatMap((segments, a) =>
    copper.slice(0, a).flatMap((other) => {
      const hit = conflicts.firstConflict(segments, other, 0.075 - 1e-8)
      return hit ? hit : []
    }),
  )
  const text = (
    x: number,
    y: number,
    value: string,
    size = 18,
    fill = "#334155",
  ) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${value}</text>`
  const panel = (layer: string, originX: number) => {
    const scale = 47,
      originY = 195
    const point = ({ x, y }: { x: number; y: number }) => ({
      x: originX + (x + 6) * scale,
      y: originY + (3 - y) * scale,
    })
    const line = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      width: number,
      stroke: string,
      extra = "",
    ) => {
      const p = point(a),
        q = point(b)
      return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${stroke}" stroke-width="${width * scale}" stroke-linecap="round" ${extra}/>`
    }
    const pads = input.connections
      .flatMap((connection) =>
        connection.pointsToConnect.map((terminal, side) => {
          const p = point(terminal)
          return `<circle cx="${p.x}" cy="${p.y}" r="${0.125 * scale}" fill="${layer === "top" ? color(connection.name) : "#fff"}" stroke="${color(connection.name)}" stroke-width="1.5"/>${text(p.x + (side ? 12 : -43), p.y + 4, `${signalNames[connection.name]}${side ? "B" : "A"}`, 12, color(connection.name))}`
        }),
      )
      .join("")
    const obstacles = input.obstacles
      .filter(
        (obstacle) =>
          obstacle.layers.includes(layer) && !obstacle.connectedTo.length,
      )
      .map((obstacle) => {
        const p = point({
          x: obstacle.center.x - obstacle.width / 2,
          y: obstacle.center.y + obstacle.height / 2,
        })
        return `<rect x="${p.x}" y="${p.y}" width="${obstacle.width * scale}" height="${obstacle.height * scale}" fill="#cbd5e1" stroke="#64748b"/>`
      })
      .join("")
    const halos = highlights
      .filter((segment) => segment.layer === layer)
      .map((segment) =>
        line(segment.a, segment.b, 0.33, "#f87171", 'opacity="0.55"'),
      )
      .join("")
    const routes = result.diagnosticTraces
      .map((trace, index) =>
        copper[index]
          .filter((segment) => segment.layer === layer)
          .map((segment) => {
            if (segment.a.x === segment.b.x && segment.a.y === segment.b.y) {
              const p = point(segment.a)
              return `<circle cx="${p.x}" cy="${p.y}" r="${segment.radius * scale}" fill="#fff" stroke="${color(trace.connection_name!)}" stroke-width="2"/>`
            }
            return line(
              segment.a,
              segment.b,
              2 * segment.radius,
              color(trace.connection_name!),
            )
          })
          .join(""),
      )
      .join("")
    return `${text(originX, 165, layer === "top" ? "TOP: pad approaches + plated vias" : "INNER1: carriers around keepouts", 20)}<rect x="${originX}" y="${originY}" width="${12 * scale}" height="${6 * scale}" fill="#f8fafc" stroke="#94a3b8"/>${obstacles}${halos}${routes}${pads}${text(originX, 505, "Board 12 × 6 mm • trace 0.100 mm • clearance 0.075 mm", 14)}`
  }
  const label = accepted
    ? "After: history preserved — bounded repair accepted"
    : "Before: history reset — bounded repair rejected"
  const status = accepted
    ? "6/6 routes accepted · 12 plated vias · 0 copper DRC issues"
    : "0 routes accepted · 6 candidate routes shown · 1 copper DRC issue"
  const stage = accepted
    ? "Coarse: 1 conflict → first fine repair: 0 conflicts"
    : "Coarse: 1 conflict → all 6 fine repairs: the same S0/S4 conflict"
  const lengths = input.connections
    .map((connection, i) => {
      const measured = result.lengths.find(
        (value) => value.connectionName === connection.name,
      )!
      return `<circle cx="${70 + i * 232}" cy="600" r="6" fill="${color(connection.name)}"/>${text(85 + i * 232, 606, `${signalNames[connection.name]}: ${measured.copperLengthMm.toFixed(3)} mm`, 18, color(connection.name))}`
    })
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="760" viewBox="0 0 1500 760"><title>${label}</title><rect width="1500" height="760" fill="#fff"/><g font-family="Arial, sans-serif">${text(50, 49, label, 28, accepted ? "#047857" : "#b91c1c")}${text(50, 85, status, 20)}${text(50, 116, stage, 18)}${panel("top", 100)}${panel("inner1", 840)}${text(70, 557, accepted ? "Real solver output: all endpoints connected and full-span via copper validated." : "Diagnostic of the final rejected candidate. Red halos mark the actual S0/S4 clearance conflict.", 18, accepted ? "#047857" : "#b91c1c")}${lengths}${text(70, 651, "Lengths include TOP approaches and INNER1 carriers; this fixture requests connectivity and clearance, without bus length constraints.", 16)}${text(70, 689, "Core compiles TSX pads, traces and keepouts → native matcher. No mocked routes or hand-authored SRJ geometry.", 16)}${text(70, 723, "Budget: 1 coarse pass + 1 pass per local stage, 100,000 expansions/search. Main can recover with a larger pass budget.", 16)}</g></svg>\n`
}

export function nativeMatchingHistoryReport(
  { signalNames }: Fixture,
  result: Result,
) {
  return {
    coreVersion: "0.0.2125",
    options: nativeMatchingHistoryOptions,
    accepted: result.traces !== null,
    allCandidateEndpointsConnected: result.complete,
    validation: result.validation,
    lengths: result.lengths.map((value) => ({
      ...value,
      signalName: signalNames[value.connectionName],
    })),
    stages: result.stages.map(({ stage, pass, collisions, unfinished }) => ({
      stage,
      pass,
      collisions,
      unfinished,
    })),
  }
}
