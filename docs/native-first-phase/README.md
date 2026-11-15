# Native first-phase pair seed reproduction

`bun test tests/native-first-phase-seed.test.ts` reproduces the skipped first-phase native seed. The unmodified helper returns immediately with no prior copper, while the existing coupled router freshly completes DQS1 on the same native endpoints in 283 yields. The input contains all physical board obstacles and unchanged derived DDR limits, with 0.30 mm drill / 0.50 mm land vias.

`bun scripts/snapshot-native-first-phase.ts` freshly solves and independently checks the scoped pair before writing its image. Checks cover endpoints/layers, native copper DRC, absolute lengths, pair skew/coupling and input immutability. This is a completed **2/2 DQS1 control only**, not a routed byte or SBC. The gzipped fixture contains no saved copper. Coordinates are board-world XY mm, +X right/+Y up; provenance accompanies the input.

![Completed DQS1 control](dqs1-completed.png)

Naively removing the eligibility guard changes the original first-byte route and breaks the existing sequential pair-repair regression. A fix must preserve the successful preferred path and introduce first-phase native seeds as bounded alternatives, retaining fallback search.

Benchmark effect: reproduction/validation only; production solver unchanged. Fresh paired all-11 Blacksmith measurements are required and will be reported in the PR before readiness.
