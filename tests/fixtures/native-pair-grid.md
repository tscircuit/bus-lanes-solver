# Core-authored native via grid reproduction

`native-pair-grid-circuit.tsx` authors two standard three-pin `sot23` interfaces and their placements, traces, pair skew/gap constraint, and a four-layer board with width 8.1 mm, height 4.1 mm, center (0.02, 0.02) mm. Published `@tscircuit/core@0.0.2125` compiles the Circuit JSON and converts it to SRJ. The fractional native grid origin (-4.03, -2.03) mm is produced directly from that board, rather than patched into the converted input. Only `allowedLayers: ["inner1"]` is added to select the isolated phase; pad/port/obstacle geometry and pair constraints are preserved.

All six rectangular pads are compiled from the published standard footprint. Both unused NC pads retain their actual geometry and ownership as foreign obstacles, and the two component bounds remain separated within the fractional board.

The test supplies a deterministic octilinear pair centerline and bounded searches to the real native planner. It observes calls to the real `NativeCarrierRouter.route`; it never substitutes successful routes. On the reproduction branch all 200 forced-via candidates are off the router's native 0.1 mm grid, so all balancing approaches fail. The connected pair retains 0.35493164 mm skew against its authored 0.1 mm limit. Projecting one of the same candidate sites to the real native grid allows the unchanged router to produce a legal approach with a real via. That control route is observed separately and is never inserted into planner output.

The SVG/PNG show actual captured pair copper, a via-center grid zoom, exact candidate/control coordinates, failed candidate count and whole-copper length skew. They are **diagnostic snapshots before residual matching**, not accepted whole-board routes. The user's explicit request to show failing reproductions authorizes them despite the repository's general restriction on failed routing artifacts. Existing AM3352 benchmark/export acceptance rules remain unchanged.

Regenerate the active branch's snapshot with:

```sh
UPDATE_NATIVE_PAIR_SNAPSHOTS=1 bun test tests/native-pair-via-grid-origin.test.ts
```

Compiler/rasterizer and Core's missing/incompatible runtime imports are pinned development dependencies. An explicit `initialSignalDogbones` return annotation preserves portable declarations when Core adds a second capacity-autorouter version, without changing behavior. The routing fix changes candidate grid arithmetic only.
