import "bun-match-svg"
import { expect, test } from "bun:test"
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
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("No collision-free local dogbone assignment")
  expect(solver.traces).toHaveLength(0)

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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="580"><rect width="980" height="580" fill="#122330"/>
<g font-family="Arial" fill="#edf3f7"><text x="28" y="42" font-size="25">HDMI routing through shared ESD pads</text>
<text x="28" y="78" font-size="19">${solver.solved ? "AFTER: 2/2 connector signals connected; existing escapes preserved" : "BEFORE: 0/2 connector signals; existing CPU copper blocks new escapes"}</text>
<text x="100" y="150" font-size="18">Existing CPU copper</text><text x="630" y="150" font-size="18">Connector J1</text>
${input.obstacles.map((o) => `<rect x="${sx(o.center.x - o.width / 2)}" y="${sy(o.center.y + o.height / 2)}" width="${o.width * 105}" height="${o.height * 140}" fill="#b38336" stroke="#e0bd76"/>`).join("")}
${draw(input.traces!, "#879ba9")}${draw(solver.traces, "#63d9fc")}
<text x="247" y="208" font-size="17">ESD P</text><text x="247" y="427" font-size="17">ESD N</text>
<text x="28" y="478" font-size="17">Gray = supplied CPU routes. Cyan = accepted connector routes. Rings = through vias.</text>
<text x="28" y="525" font-family="monospace" font-size="17">&lt;trace from=".ESD &gt; .P" to=".J1 &gt; .P" /&gt;</text>
<text x="28" y="555" font-family="monospace" font-size="17">&lt;board layers={4} allowBlindAndBuriedVias={false} /&gt;</text></g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
