import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { pairLengthReports } from "../lib/route-lengths"
import { BusLanesPipelineSolver } from "../lib"
import type { SimpleRouteJson, Trace } from "../lib/types"
import fixture from "./fixtures/hdmi-shared-pad.json"

// The CPU-side phase already reaches both ESD pads. The connector-side phase
// must tap those same owned escapes; new vias at the pads would collide.
test("sequential HDMI routing reuses the supplied ESD pad escapes", async () => {
  const input = structuredClone(fixture) as SimpleRouteJson
  const before = JSON.stringify(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(JSON.stringify(input)).toBe(before)
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(2)
  const output = solver.getOutput()
  expect(output.traces.slice(0, input.traces!.length)).toEqual(input.traces!)
  const connections = [
    ...input.connections,
    ...input.traces!.map((t) => ({
      name: t.connection_name!,
      pointsToConnect: [
        t.route[0],
        t.route.at(-1)!,
      ] as SimpleRouteJson["connections"][number]["pointsToConnect"],
    })),
  ]
  const context = {
    inputSrj: { ...input, connections },
    routedSrj: { ...output, connections },
  } as unknown as Parameters<typeof validateOriginalEndpointConnectivity>[0]
  expect(validateOriginalEndpointConnectivity(context).issues).toEqual([])
  expect(
    validateRoutedCopperDrc({ ...context, clearance: 0.1 }).issues,
  ).toEqual([])
  expect(pairLengthReports(input, solver.traces).every((r) => r.matched)).toBe(
    true,
  )
  for (const trace of solver.traces) {
    const prior = input.traces!.find(
      (t) => t.connection_name === `CPU_${trace.connection_name}`,
    )!
    expect(trace.route.slice(0, 3)).toEqual(prior.route.slice(0, 3))
    expect(
      trace.route
        .filter((p) => p.route_type === "via")
        .every((p) => p.layers?.join() === "top,inner1,inner2,bottom"),
    ).toBe(true)
  }

  const sx = (x: number) => 480 + x * 105
  const sy = (y: number) => 315 - y * 140
  const draw = (traces: Trace[], color: string) =>
    traces
      .map((t) => {
        const lines = t.route
          .flatMap((p, i) => {
            const q = t.route[i + 1]
            return p.route_type === "wire" &&
              q?.route_type === "wire" &&
              p.layer === q.layer
              ? [
                  `<path d="M${sx(p.x)} ${sy(p.y)}L${sx(q.x)} ${sy(q.y)}" stroke="${color}" stroke-width="${p.width * 105}" fill="none"/>`,
                ]
              : []
          })
          .join("")
        const vias = t.route
          .filter((p) => p.route_type === "via")
          .map(
            (p) =>
              `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${(p.via_diameter! * 105) / 2}" stroke="${color}" stroke-width="5" fill="#122330"/>`,
          )
          .join("")
        return lines + vias
      })
      .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="750"><rect width="980" height="750" fill="#122330"/>
<g font-family="Arial" fill="#edf3f7"><text x="28" y="42" font-size="25">HDMI routing through shared ESD pads</text>
<text x="28" y="78" font-size="19">${solver.solved ? "AFTER: 2/2 connector signals connected; existing escapes preserved" : "BEFORE: 0/2 connector signals; existing CPU copper blocks new escapes"}</text>
<text x="100" y="150" font-size="18">Existing CPU copper</text><text x="630" y="150" font-size="18">Connector J1</text>
${input.obstacles.map((o) => `<rect x="${sx(o.center.x - o.width / 2)}" y="${sy(o.center.y + o.height / 2)}" width="${o.width * 105}" height="${o.height * 140}" fill="#b38336" stroke="#e0bd76"/>`).join("")}
${draw(input.traces!, "#879ba9")}${draw(solver.traces, "#63d9fc")}
<text x="247" y="208" font-size="17">ESD P</text><text x="247" y="427" font-size="17">ESD N</text>
<text x="28" y="640" font-size="17">Gray = supplied CPU routes. Cyan = accepted routes. Rings = through vias.</text>
<text x="28" y="695" font-family="monospace" font-size="17">&lt;trace from=".ESD &gt; .P" to=".J1 &gt; .P" /&gt;</text>
<text x="28" y="725" font-family="monospace" font-size="17">&lt;board layers={4} allowBlindAndBuriedVias={false} /&gt;</text></g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
