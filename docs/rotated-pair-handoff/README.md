The inspected snapshots show two fresh, connected and DRC/matching-validated
routes of physically identical isolated native input. The reproduction chooses
different copper because package handoff extents ignore rectangle rotation.
They are focused fixture visuals, not completed SBC snapshots.

Local shared-worker observations: base rotated 8,574 steps / 2.96 s; equivalent
axis-aligned 18,418 steps / 6.43 s. Fixed rotated and axis-aligned both use 18,418
steps and identical copper (6.26 / 5.85 s). This fixes representation dependence,
not a measured speedup. In this isolated input the corrected rotated case takes
more work; full benchmark regressions must be reviewed, not hidden.

Run `bun scripts/benchmark-rotated-pair-handoff.ts /path/to/revision/lib/coupled-pair-routing.ts report.json`
for each pinned revision. The Blacksmith workflow runs the same head harness
against fresh base/head solvers and retains geometry equality, DRC, original
pair skew/coupling and timing reports. The standard 11/11 AM3352 benchmark is
also mandatory. Do not claim pending checks as passes.
