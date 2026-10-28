# Smooth return-leg spacing reproduction

![Completed TSX circuit and independently measured gap](before.png)

Run `bun install`, `bun test tests/meander-return-gap.test.ts`, and
`bun scripts/repro-meander-return-gap.ts` from the repository root.

The source is `tests/fixtures/meander-return-gap.tsx`: four real SMT pads,
two traces, and one length-matched bus. Core renders that TSX and converts it
to SRJ, including the bus declaration. The public `BusLanesPipelineSolver`
routes it from scratch; no Circuit JSON or saved routes are authored by hand.
The generator refuses an unfinished solver or an unmatched bus.

Review the orange dimension in the magnified panel. Two opposite returning
straight legs measure **0.240 mm center-to-center**, hence **0.140 mm edge gap**
with a 0.100 mm trace. The documented three-width centerline floor would require
0.300 mm center-to-center / 0.200 mm edge-to-edge. Pad clearance is a separate
constraint. Both signals are complete and their bus skew is 0.010 mm.

The ordinary test proves the fixture solves. The separate `test.failing`
asserts the documented spacing requirement and records the known defect.
`measure-return-gap.ts` independently measures overlapping antiparallel long
segments, excluding sampled arc chords; it does not call the solver's spacing
predicate. `before.json` records the measured points and complete bus report.

The follow-on fix should remove `test.failing`, preserve this before image,
and add after images for the default and a larger requested edge gap.

## Benchmark effect

This reproduction changes no solver implementation or AM3352 fixtures. Core
and its runtime dependencies are development-only dependencies needed to render
the TSX; the compatible Circuit JSON/util versions also allow the core renderer
to load. The package export remains the solver. Fresh base/head AM3352 runs
are still required by `AGENTS.md`; the PR's Blacksmith matrix runs all 11
samples with 3,600 seconds per solver/sample and retains the raw comparison.
Pending or incomplete benchmark checks do not establish merge readiness.
