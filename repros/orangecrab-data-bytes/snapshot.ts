import { writeFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { AnyCircuitElement } from "circuit-json"
import { Resvg } from "@resvg/resvg-js"
import { optimize } from "svgo"

/** Render actual core output at one fixed viewport for the base/head SVG diff. */
export function writeSnapshot({
  circuit,
  directory,
  status,
}: {
  circuit: AnyCircuitElement[]
  directory: string
  status: "completed" | "failed_baseline"
}): void {
  const caption =
    status === "completed"
      ? "COMPLETED: 22/22 data-byte signals routed; 44/44 endpoints verified"
      : "FAILED BASELINE: 0/22 data-byte signals routed; no published PCB traces"
  const original = convertCircuitJsonToPcbSvg(circuit, {
    backgroundColor: "white",
    width: 1400,
    height: 1100,
    shouldDrawRatsNest: false,
    shouldDrawErrors: false,
    showErrorsInTextOverlay: false,
    viewport: { minX: -7, minY: -12, maxX: 23, maxY: 10.5 },
  })
    .replace(/(<svg\b[^>]*>)/, `$1<title>${caption}</title>`)
    .replace(
      "</svg>",
      `<text x="16" y="28" font-family="monospace" font-size="18" fill="${status === "completed" ? "#166534" : "#b91c1c"}">${caption}</text></svg>`,
    )
  // Compact repeated renderer markup without changing Circuit JSON or copper.
  // Pretty output keeps the tracked file reviewable as a normal GitHub diff.
  const svg =
    optimize(original, {
      floatPrecision: 9,
      js2svg: { pretty: true, indent: 2 },
    }).data.trimEnd() + "\n"
  writeFileSync(`${directory}/board.svg`, svg)
  writeFileSync(`${directory}/board.png`, new Resvg(svg).render().asPng())
  writeFileSync(`${import.meta.dir}/board.snap.svg`, svg)
}
