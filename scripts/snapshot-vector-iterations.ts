import { BusLanesSolver } from "../lib"
import { channelInput } from "../examples/vector-channel"
import { getPngFromLogString } from "graphics-debug"
import { mkdir } from "node:fs/promises"
const directory = "docs/iterations/vector-final"
await mkdir(directory, { recursive: true })
for (const [name, input] of [
  ["obstacle-channel", channelInput()],
  [
    "right",
    await Bun.file("tests/fixtures/two-fanouts/ddr_right_io_left.json").json(),
  ],
] as const) {
  const s = new BusLanesSolver(input)
  const targets = name === "right" ? [0, 10, 30, 50, 100] : [0, 1, 2, 4, 8, 100]
  for (const n of targets) {
    while (s.iterations < n && !s.solved && !s.failed) s.step()
    await Bun.write(
      `${directory}/${name}-${n}.png`,
      await getPngFromLogString(":graphics " + JSON.stringify(s.visualize())),
    )
    await Bun.write(
      `${directory}/${name}-${n}.json`,
      JSON.stringify({
        iteration: s.iterations,
        stats: s.stats,
        solved: s.solved,
        error: s.error,
      }),
    )
    console.log(name, n, s.iterations, s.solved, s.stats.lane)
  }
}
