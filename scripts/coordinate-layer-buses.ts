import { FanoutSolver } from "@tscircuit/fanout-solver"
const profile = process.argv[2] ?? "ddr_right_io_left",
  side = process.argv[3] ?? "ram",
  other = side === "ram" ? "soc" : "ram"
const source = await Bun.file(
    `examples/fanout-solver-outputs/${profile}-${side}.json`,
  ).json(),
  target = await Bun.file(
    `examples/fanout-solver-outputs/${profile}-${other}.json`,
  ).json()
const endpoints = new Map(
  target.output.fanoutTraces.map((t: any) => [
    t.connection_name,
    t.route.at(-1),
  ]),
)
const layers = [...new Set([...endpoints.values()].map((p: any) => p.layer))]
const buses = layers.map((layer) => {
  const names = [...endpoints.entries()]
    .filter(([name, p]: any) => p.layer === layer)
    .sort((a: any, b: any) => a[1].y - b[1].y || a[1].x - b[1].x)
    .map(([name]) => name)
  return {
    busId: `DDR_${layer}`,
    connectionNames: names,
    exitPosition: source.options.buses[0].exitPosition,
    allowedLayers: [layer, layer === "top" ? "bottom" : "top"],
    connectionExitTargets: Object.fromEntries(
      names.map((name) => {
        const p = endpoints.get(name)
        return [name, { x: p.x, y: p.y, layer: p.layer }]
      }),
    ),
  }
})

const options = { ...source.options, buses, maxLayerCombinations: 1 },
  input = { ...source.input, buses }
const s = new FanoutSolver(input, options)
let last = Date.now()
while (!s.solved && !s.failed) {
  s.step()
  if (Date.now() - last > 10000) {
    console.log(s.iterations, s.stats)
    last = Date.now()
  }
}
console.log("result", s.solved, s.error)
if (s.solved)
  await Bun.write(
    `.cache/layer-coordinated-${profile}-${side}.json`,
    JSON.stringify({ input, options, output: s.getOutput() }),
  )
