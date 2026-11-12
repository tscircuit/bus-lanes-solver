import "bun-match-svg"
import { expect, test } from "bun:test"
import { routeCoupledPairTopology } from "../lib/coupled-pair-routing"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { pairLengthReports } from "../lib/route-lengths"
import { fixedCopper } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("a short paired corridor can detour on a board larger than the dense-grid budget", async () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.06,
    minTraceToPadEdgeClearance: 0.06,
    bounds: { minX: -50, maxX: 50, minY: -37.5, maxY: 37.5 },
    connections: ["P", "N"].map((name, k) => ({
      name,
      pointsToConnect: [
        { x: k * 0.16, y: 0, layer: "inner1" },
        { x: k * 0.16, y: -10, layer: "inner1" },
      ],
    })),
    obstacles: [
      {
        center: { x: 0, y: -5 },
        width: 2,
        height: 0.3,
        layers: ["inner1"],
        connectedTo: [],
        componentId: "blocker",
      },
      ...[-49, 49].map((x) => ({
        center: { x, y: x < 0 ? -36 : 36 },
        width: 0.2,
        height: 0.2,
        layers: ["inner1"],
        connectedTo: [],
        componentId: "far",
      })),
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.1, lengthTolerance: 0.1 },
    ],
  }
  for (const connection of input.connections)
    for (const [end, point] of connection.pointsToConnect.entries())
      input.obstacles.push({
        componentId: `U${end}`,
        center: point,
        width: 0.06,
        height: 0.06,
        layers: ["inner1"],
        connectedTo: [connection.name],
      })
  const route = routeCoupledPairTopology({
    input,
    pair: input.differentialPairs![0],
    fixed: fixedCopper(input),
  })
  let traces: Trace[] = []
  let error: unknown
  try {
    for (;;) {
      const step = route.next()
      if (step.done) {
        traces = step.value ?? []
        break
      }
    }
  } catch (cause) {
    error = cause
  } finally {
    route.return(null)
  }
  expect(error).toBeUndefined()
  expect(traces).toHaveLength(2)
  const context = {
    inputSrj: input,
    routedSrj: { ...input, traces },
  } as unknown as Parameters<typeof validateOriginalEndpointConnectivity>[0]
  expect(validateOriginalEndpointConnectivity(context).issues).toEqual([])
  expect(
    validateRoutedCopperDrc({ ...context, clearance: 0.06 }).issues,
  ).toEqual([])
  expect(pairLengthReports(input, traces).every((r) => r.matched)).toBe(true)
  const sx = (x: number) => 230 + x * 55,
    sy = (y: number) => 145 - y * 43
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="700"><rect width="980" height="700" fill="#122330"/><g font-family="Arial" fill="#edf3f7"><text x="28" y="42" font-size="25">A short HDMI pair on a large board</text><text x="28" y="78" font-size="19">${traces.length ? "AFTER: both signals detour around the obstacle; clearance and matching pass" : "BEFORE: no route; unrelated distant copper exceeds the grid budget"}</text><rect x="${sx(-1)}" y="${sy(-4.85)}" width="110" height="12.9" fill="#df7e72"/>
${traces.map((t, i) => `<polyline points="${t.route.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}" stroke="${i ? "#ffc574" : "#63d9fc"}" stroke-width="3.3" fill="none"/>`).join("")}
${input.connections.flatMap((c, i) => c.pointsToConnect.map((p) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="5" fill="${i ? "#ffc574" : "#63d9fc"}"/>`)).join("")}
<text x="460" y="190" font-size="19">10 mm pair; 100 × 75 mm board</text><text x="460" y="235" font-size="17">Red obstacle must still be avoided.</text><text x="460" y="267" font-size="17">Distant copper stays in the clearance scene.</text><text x="460" y="299" font-size="17">No grid-budget or clearance increase.</text><text x="460" y="365" font-size="17">Trace width 0.06 mm; pair gap 0.10 mm</text><text x="460" y="397" font-size="17">Pair skew limit 0.10 mm</text><text x="28" y="642" font-family="monospace" font-size="17">&lt;board width="100mm" height="75mm" layers={4}&gt;</text><text x="28" y="674" font-size="17">Only completed pair copper is drawn. Endpoint separation: 10 mm.</text></g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
