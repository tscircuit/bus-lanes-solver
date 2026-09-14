import { FanoutSolver } from "@tscircuit/fanout-solver"
// Inputs and options are saved verbatim so this invokes the real package solver,
// without the old grid router, pre-routed carrier copper, or relocated exits.
const profiles = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "ddr_left_io_right",
      "ddr_right_io_left",
      "ddr_top_io_bottom",
      "ddr_bottom_io_top",
    ]
for (const profile of profiles) {
  for (const side of ["soc", "ram"]) {
    const file = `examples/fanout-solver-outputs/${profile}-${side}.json`
    const record = await Bun.file(file).json()
    const solver = new FanoutSolver(record.input, record.options)
    solver.solve()
    if (!solver.solved) throw Error(`${profile}/${side}: ${solver.error}`)
    const output = solver.getOutput()
    if (!output.validation.valid || output.fanoutTraces.length !== 33)
      throw Error("Invalid or incomplete fanout")
    await Bun.write(
      file,
      JSON.stringify({ input: record.input, options: record.options, output }),
    )
    console.log(`${profile}/${side}: ${output.fanoutTraces.length}/33`)
  }
}
const child = Bun.spawn(
  [process.execPath, "scripts/assemble-real-fanouts.ts", ...profiles],
  { stdout: "inherit", stderr: "inherit" },
)
if (await child.exited) process.exit(1)
