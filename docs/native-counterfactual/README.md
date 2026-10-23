# Native counterfactual selection reproduction

`bun test tests/native-counterfactual-choice.test.ts` freshly solves BYTE1 from the existing public native fixture, then computes D0 with the pair released. The one-signal compatibility pool reverses four candidates and replaces the shortest candidate with its last candidate: TOP, 24.405 mm. DQM0 then has no escape domain (24 yields). Three BOTTOM alternatives are shorter (23.243–24.043 mm) and let the existing bounded router complete DQM0 (33 yields each).

This establishes individual reachability, not a joint BYTE0 or SBC solve. The input is unchanged. Coordinates are board-world XY mm, +X right/+Y up. All fixed BYTE1 copper is freshly solved; no saved route or manually authored route is loaded. Via drill/land dimensions remain 0.30/0.50 mm.

`bun scripts/snapshot-native-counterfactual.ts` freshly computes and independently validates the completed **D0 net only** below, around freshly solved BYTE1 (grey). The exporter refuses output unless native pad connectivity through all owned dogbones, native DRC, absolute D0 length and scoped length matching pass. It separately checks prior BYTE1 bus length, pair skew and physical coupling. Full BYTE0 matching is not established by this scoped control. Failed DQM0 diagnostic captures are never exported.

![Completed D0 control](d0-control-completed.png)

The eventual repair must consider ordinary seed copper when detecting duplicate states: a compatible new ordinary prefix is progress even if the pair is unchanged. Simply selecting the shortest candidate while retaining a pair-only duplicate key discards these alternatives. Any replacement must still check pair geometry and future escape access, keep fixed input copper immutable, bound child work and pass the full legacy benchmark.

Benchmark effect: tests and validation only; production solver unchanged. Every PR must have a fresh paired Blacksmith 11/11 comparison, reported before readiness.
