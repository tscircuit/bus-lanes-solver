import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"
const dir = new URL("../repros/handheld-gaming-console/", import.meta.url)
const read = (s: string) => readFileSync(new URL(s, dir))
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")
test("handheld reproduction retains native pad positions and all 65 requested nets", () => {
  const meta = JSON.parse(read("provenance.json").toString())
  expect(
    sha(read("../../tests/fixtures/handheld-gaming-console/input.srj.json")),
  ).toBe(meta.input_sha256)
  expect(
    sha(read("../../tests/fixtures/handheld-gaming-console/pads.json")),
  ).toBe(meta.source_pads_sha256)
  expect(sha(gunzipSync(read("source/board.kicad_pcb.gz")))).toBe(
    meta.source_board_sha256,
  )
  const input = JSON.parse(
    read(
      "../../tests/fixtures/handheld-gaming-console/input.srj.json",
    ).toString(),
  )
  const pads = JSON.parse(
    read("../../tests/fixtures/handheld-gaming-console/pads.json").toString(),
  )
  expect(input.connections).toHaveLength(65)
  expect(input.obstacles).toHaveLength(pads.length)
  expect(new Set(input.connections.map((c: any) => c.name)).size).toBe(65)
  expect(input.traces ?? []).toHaveLength(0)
  for (const c of input.connections) {
    const native = pads.filter((p: any) => p.net === c.name)
    expect(native).toHaveLength(2)
    expect(c.pointsToConnect).toHaveLength(2)
    for (const point of c.pointsToConnect) {
      const p = native.find(
        (p: any) => `${p.reference}_${p.number}` === point.pcb_port_id,
      )
      expect(p).toBeDefined()
      expect(point.x).toBeCloseTo(p.position[0] - 100, 6)
      expect(point.y).toBeCloseTo(100 - p.position[1], 6)
      const obstacle = input.obstacles.find((o: any) =>
        o.connectedTo.includes(point.pcb_port_id),
      )
      expect(obstacle.center).toEqual({ x: point.x, y: point.y })
    }
  }
})

test("handheld input snapshots are reproducible and refuse candidate copper", async () => {
  const { loadInput } = await import("../repros/handheld-gaming-console/input")
  const { renderInputSnapshot } = await import(
    "../repros/handheld-gaming-console/snapshot"
  )
  const input = loadInput()
  const unchanged = JSON.stringify(input)
  for (const [file, zoom] of [
    ["board.snap.svg", false],
    ["cpu-escape.snap.svg", true],
  ] as const) {
    const svg = renderInputSnapshot(input, zoom)
    expect(svg).toBe(read(file).toString())
    expect(svg).toContain("UNROUTED INPUT")
    expect(svg).toContain("0 / 65 accepted routes")
    expect(svg).toContain("dashed lines are requests, not copper")
    expect(svg.match(/data-airwire=/g)?.length).toBe(
      zoom ? input.buses![0].connectionNames.length : 65,
    )
  }
  const copper = structuredClone(input)
  copper.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "unaccepted",
      connection_name: "DQ0_A",
      route: [],
    },
  ]
  expect(() => renderInputSnapshot(copper)).toThrow(
    "refuses supplied or candidate copper",
  )
  expect(JSON.stringify(input)).toBe(unchanged)
})
