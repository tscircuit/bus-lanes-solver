# Core-authored offset trunk reproduction

`native-pair-trunk-circuit.tsx` authors two physical two-pad packages, their placement and rotation, two traces, a four-layer board and a `differentialpair` with `maxLengthSkew={0.1}`. Published `@tscircuit/core@0.0.2125` renders the Circuit JSON; its exported `getSimpleRouteJsonFromCircuitJson` converts the real pads, port ownership and pair constraint into SRJ. Only `allowedLayers: ["inner1"]` is added to select the isolated inner-layer phase. No endpoint or obstacle geometry is replaced.

The test supplies a deterministic right-angle pair centerline and search budgets to the real native planner. Its real package approaches, vias and trunk copper are observed at the `BusLanesSolver.forRefinement` boundary; the later residual-meander stage is deliberately not run. The independent copper DRC and both source/destination endpoints pass. On the reproduction branch the complete native proposal has 0.45857864 mm skew, violating the authored 0.1 mm bound by 0.35857864 mm. This extra correction is handed to refinement because initial pair balancing ignored unequal offset trunk lengths.

The labeled SVG and PNG are **diagnostic snapshots**, not accepted whole-board routes. They show actual captured copper and independently measured whole-copper lengths. The user's explicit request to show failing reproductions authorizes these diagnostics despite the repository's general restriction on failed routing artifacts. Existing AM3352 benchmark/export acceptance rules remain unchanged.

Regenerate the active branch's snapshot with:

```sh
UPDATE_NATIVE_PAIR_SNAPSHOTS=1 bun test tests/native-pair-trunk-length.test.ts
```

The fixture compiler and rasterizer are pinned dev dependencies. Additional direct runtime pins repair missing or incompatible imports in the published Core dependency tree; they do not change the solver's production source.
