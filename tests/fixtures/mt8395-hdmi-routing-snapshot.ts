import type { SimpleRouteJson, Trace } from "../../lib/types"

/** Actual core pad geometry and accepted copper, in board-world mm (+Y up).
 * The failed baseline deliberately draws no unaccepted candidate routes. */
export function mt8395HdmiRoutingSnapshot(input: SimpleRouteJson, traces: Trace[]) {
  const esc = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  const colors = ["#ffd879", "#f6a6dd"]
  const routed = traces.length === 2
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820"><rect width="1200" height="820" fill="#10212d"/><style>text{font-family:Arial,sans-serif;fill:#eef3f8}.code{font-family:monospace}</style><text x="28" y="42" font-size="25" font-weight="bold">MT8395 HDMI: finish the CPU-to-ESD pair</text><text x="28" y="79" font-size="20">${routed ? "AFTER: 2/2 complete routes; connectivity, clearance and matching pass" : "BEFORE: 0/2 complete routes; local reconnection exceeds grid budget"}</text>`
  const panels = [
    { id: "route", x: 28, y: 142, w: 485, h: 565, minX: -11, maxX: 3, minY: -24.5, maxY: -5.2 },
    { id: "cpu", x: 550, y: 440, w: 270, h: 250, minX: -9.25, maxX: -7.45, minY: -7.5, maxY: -5.9 },
    { id: "esd", x: 850, y: 440, w: 315, h: 250, minX: -1.3, maxX: 0.5, minY: -23.6, maxY: -22 },
  ]
  for (const p of panels) {
    const scale = Math.min(p.w / (p.maxX - p.minX), p.h / (p.maxY - p.minY))
    const X = (x: number) => p.x + (x - p.minX) * scale
    const Y = (y: number) => p.y + (p.maxY - y) * scale
    svg += `<defs><clipPath id="${p.id}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/></clipPath></defs><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#18353f" stroke="#65818e"/><g clip-path="url(#${p.id})">`
    for (const o of input.obstacles) {
      if (!o.layers.includes("top") || o.center.x + o.width / 2 < p.minX || o.center.x - o.width / 2 > p.maxX || o.center.y + o.height / 2 < p.minY || o.center.y - o.height / 2 > p.maxY) continue
      svg += o.shape === "circle"
        ? `<circle cx="${X(o.center.x)}" cy="${Y(o.center.y)}" r="${o.width * scale / 2}" fill="#70858d"/>`
        : `<rect x="${X(o.center.x - o.width / 2)}" y="${Y(o.center.y + o.height / 2)}" width="${o.width * scale}" height="${o.height * scale}" fill="#70858d"/>`
    }
    for (const [index, connection] of input.connections.entries()) {
      const color = colors[index]
      for (const t of traces.filter((t) => t.connection_name === connection.name)) {
        for (let i = 1; i < t.route.length; i++) {
          const a = t.route[i - 1], b = t.route[i]
          svg += `<path d="M${X(a.x)} ${Y(a.y)}L${X(b.x)} ${Y(b.y)}" fill="none" stroke="${color}" stroke-width="${(a.route_type === "wire" ? a.width : input.minTraceWidth) * scale}" stroke-linecap="round"/>`
        }
        for (const v of t.route.filter((v) => v.route_type === "via"))
          svg += `<circle cx="${X(v.x)}" cy="${Y(v.y)}" r="${(v.via_diameter ?? 0.15) * scale / 2}" fill="${color}"/><circle cx="${X(v.x)}" cy="${Y(v.y)}" r="${(v.via_hole_diameter ?? 0.075) * scale / 2}" fill="#10212d"/>`
      }
      for (const terminal of connection.pointsToConnect)
        svg += `<circle cx="${X(terminal.x)}" cy="${Y(terminal.y)}" r="${Math.max(4, 0.15 * scale)}" fill="none" stroke="${color}" stroke-width="1.5"/>`
    }
    svg += "</g>"
  }
  const lines = [
    '<board width={100} height={75} layers={8}',
    '  allowBlindAndBuriedVias>',
    '  <trace name="HDMI_CH2_CPU_P"',
    '    from="U1.AR36" to="U_HDMI.23" />',
    '  <trace name="HDMI_CH2_CPU_N"',
    '    from="U1.AR35" to="U_HDMI.22" />',
    '  <bus pcbAllowedLayers={["inner4"]}',
    '    maxLengthSkew={0.1} ... />',
    '</board>',
  ]
  lines.forEach((line, i) => { svg += `<text x="550" y="${150 + i * 27}" font-size="17" class="code">${esc(line)}</text>` })
  svg += `<text x="550" y="413" font-size="19">CPU pads / local vias</text><text x="850" y="413" font-size="19">ESD pads / local vias</text><text x="28" y="735" font-size="17">Gold: P. Pink: N. Gray: top pads. Copper comes only from completed output.</text><text x="28" y="765" font-size="17">Exact core request: 2 signals, 138 retained DDR traces, all board obstacles. Relevant TSX excerpt shown.</text><text x="28" y="795" font-size="17">${routed ? "Local package search finishes without allocating a board-wide grid. Full-board clearance checks still apply." : "No new copper is accepted. The package reconnection search attempts more than 8 million grid cells."}</text></svg>`
  return svg
}
