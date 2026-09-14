import { BusLanesSolver } from "../lib"
import { channelInput } from "../examples/vector-channel"
import { getPngFromLogString } from "graphics-debug"
import { mkdir } from "node:fs/promises"
const directory = process.argv[2] ?? "docs/iterations/length-matched"
await mkdir(directory, { recursive: true })
const cases: any[] = [["obstacle-channel", channelInput()]]
for (const profile of [
  "ddr_left_io_right",
  "ddr_right_io_left",
  "ddr_top_io_bottom",
  "ddr_bottom_io_top",
])
  cases.push([
    profile,
    await Bun.file(`tests/fixtures/two-fanouts/${profile}.json`).json(),
  ])
for (const [name, input] of cases) {
  const solver = new BusLanesSolver(input)
  for (const n of name === "obstacle-channel"
    ? [0, 2, 4, 8, 1000]
    : [0, 10, 30, 1000]) {
    while (solver.iterations < n && !solver.solved && !solver.failed)
      solver.step()
    const label = n === 1000 ? "solved" : String(solver.iterations)
    await Bun.write(
      `${directory}/${name}-${label}.png`,
      await getPngFromLogString(
        ":graphics " + JSON.stringify(solver.visualize()),
      ),
    )
    await Bun.write(
      `${directory}/${name}-${label}.json`,
      JSON.stringify({
        iteration: solver.iterations,
        stats: solver.stats,
        solved: solver.solved,
        error: solver.error,
      }),
    )
    console.log(
      name,
      label,
      solver.iterations,
      solver.solved,
      solver.stats.lane,
    )
  }
  if (!solver.solved) throw Error(`${name}: ${solver.error}`)
}
