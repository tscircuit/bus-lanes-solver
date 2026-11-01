import { Circuit } from "tscircuit"
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { resolve } from "node:path"
import { EventEmitter } from "node:events"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import Board from "../orangecrab-byte0/circuits/orangecrab"
const [label = "after", solverModule = "../../lib/index.ts"] =
  process.argv.slice(2)
const modulePath = resolve(import.meta.dir, solverModule)
const id = "orangecrab"
const { BusLanesPipelineSolver } = await import(modulePath)
const directory = `${import.meta.dir}/results/${label}`
mkdirSync(directory, { recursive: true })
for (const filename of ["board.svg", "board.png"])
  rmSync(`${directory}/${filename}`, { force: true })
let solver: InstanceType<typeof BusLanesPipelineSolver> | undefined
class LocalBusRouter extends EventEmitter {
  isRouting = false
  constructor(
    readonly input: ConstructorParameters<typeof BusLanesPipelineSolver>[0],
  ) {
    super()
  }
  start(): void {
    this.isRouting = true
    setTimeout(() => {
      try {
        writeFileSync(`${directory}/input.srj.json`, JSON.stringify(this.input))
        solver = new BusLanesPipelineSolver(this.input, {
          maxRoutingTimeMs: 120000,
        })
        let lastReport = performance.now()
        while (!solver.solved && !solver.failed) {
          solver.step()
          if (performance.now() - lastReport >= 10000) {
            lastReport = performance.now()
            console.log(
              JSON.stringify({ phase: solver.phase, steps: solver.iterations }),
            )
          }
        }
        writeFileSync(
          `${directory}/solver.json`,
          JSON.stringify(
            {
              solved: solver.solved,
              failed: solver.failed,
              error: solver.error,
              stats: solver.stats,
              iterations: solver.iterations,
            },
            null,
            2,
          ),
        )
        if (!solver.solved || solver.failed)
          throw Error(solver.error ?? "Bus solver failed")
        const output = solver.getOutput()
        writeFileSync(`${directory}/output.srj.json`, JSON.stringify(output))
        this.isRouting = false
        this.emit("complete", { type: "complete", traces: solver.traces })
      } catch (error) {
        this.isRouting = false
        this.emit("error", {
          type: "error",
          error: error instanceof Error ? error : Error(String(error)),
        })
      }
    }, 0)
  }
  stop(): void {
    this.isRouting = false
  }
  solveSync() {
    throw Error("Use the asynchronous core routing lifecycle")
  }
  getOutputSimpleRouteJson() {
    return solver?.solved ? solver.getOutput() : undefined
  }
}
const source = JSON.parse(
  readFileSync(
    `${import.meta.dir}/../orangecrab-byte0/source-data/${id}.json`,
    "utf8",
  ),
)
const connectionNames = new Set<string>(
  source.groups
    .slice(0, 2)
    .flatMap((group: { connections: string[] }) => group.connections),
)
const board: ReactElement<{ children?: ReactNode }> = Board({ staged: true })
const children = Children.toArray(board.props.children).flatMap((child) => {
  if (
    !isValidElement<{
      phaseIndex?: number
      routingPhaseIndex?: number
      connections?: string[]
      algorithmFn?: (
        input: ConstructorParameters<typeof BusLanesPipelineSolver>[0],
      ) => Promise<LocalBusRouter>
      positiveConnection?: string
      negativeConnection?: string
    }>(child)
  )
    return [child]
  if (child.type === "autoroutingphase") {
    if (child.props.phaseIndex !== 0) return []
    return [
      cloneElement(child, {
        connections: [...connectionNames],
        algorithmFn: async (
          input: ConstructorParameters<typeof BusLanesPipelineSolver>[0],
        ) => new LocalBusRouter(input),
      }),
    ]
  }
  if (child.type === "bus") {
    if (
      child.props.routingPhaseIndex !== 0 &&
      child.props.routingPhaseIndex !== 1
    )
      return []
    return [cloneElement(child, { routingPhaseIndex: 0 })]
  }
  if (child.type === "trace") {
    const selected =
      child.props.routingPhaseIndex === 0 || child.props.routingPhaseIndex === 1
    const routingPhaseIndex = selected ? 0 : undefined
    return [cloneElement(child, { routingPhaseIndex })]
  }
  if (child.type === "differentialpair") {
    if (!child.props.positiveConnection || !child.props.negativeConnection)
      return []
    if (
      !connectionNames.has(child.props.positiveConnection) ||
      !connectionNames.has(child.props.negativeConnection)
    )
      return []
  }
  return [child]
})
const circuit = new Circuit()
const asyncErrors: string[] = []
circuit.on("asyncEffect:end", (event) => {
  if (event.error) asyncErrors.push(String(event.error))
})
const started = performance.now()
circuit.add(cloneElement(board, {}, children))
await circuit.renderUntilSettled()
const json = circuit.getCircuitJson()
writeFileSync(`${directory}/circuit.json`, JSON.stringify(json))
const summary = {
  label,
  id,
  seconds: (performance.now() - started) / 1000,
  asyncErrors,
  traces: circuit.db.pcb_trace.list().length,
  vias: circuit.db.pcb_via.list().length,
  pads: circuit.db.pcb_smtpad.list().length,
  sourceTraces: circuit.db.source_trace.list().length,
  solved: solver?.solved ?? false,
}
writeFileSync(`${directory}/summary.json`, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary))
