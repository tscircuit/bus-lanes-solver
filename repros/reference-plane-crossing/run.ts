import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesSolver } from "../../lib"
import { checkReferenceCoverage } from "./check-reference-coverage"
import { crossingInput, powerConnection, projectedCut } from "./fixture"

export function runCase(maskLayer?: string) {
  const input = crossingInput()
  if (maskLayer) input.obstacles.push(projectedCut(maskLayer))
  const originalFixedCopper = JSON.stringify(input.traces)
  const solver = new BusLanesSolver(input)
  solver.solve()
  if (!solver.solved) throw new Error(solver.error ?? "Solver did not complete")
  // Native copper DRC needs ownership for supplied power as well as new signals.
  const fullInput = {
    ...input,
    connections: [...input.connections, powerConnection],
  }
  const copperDrc = validateRoutedCopperDrc({
    inputSrj: fullInput,
    routedSrj: {
      ...fullInput,
      traces: [...(input.traces ?? []), ...solver.traces],
    },
    clearance: 0.1,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  return {
    maskLayer: maskLayer ?? null,
    solved: solver.solved,
    fixedCopperUnchanged:
      JSON.stringify(input.traces) === originalFixedCopper &&
      JSON.stringify(solver.input.traces) === originalFixedCopper,
    copperDrc,
    referenceCoverage: checkReferenceCoverage(solver.traces),
    traces: solver.traces,
  }
}

if (import.meta.main) {
  console.log(
    JSON.stringify(
      {
        baseline: runCase(),
        wrongLayerControl: runCase("top"),
        projectedMaskControl: runCase("bottom"),
      },
      null,
      2,
    ),
  )
}
