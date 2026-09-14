# Vector routing audit

The previous raster search has been removed. The router now builds a visibility graph from the corners of clearance-offset copper. Each graph edge is an analytic horizontal, vertical, or 45-degree polyline. Collision predicates operate on continuous segments, rectangles and via disks; there is no cell size or coordinate stepping. Terminal fields are swept perpendicular to the channel direction, grouped by layer, with alternate winding orders on failure.

Snapshots are reproducible with `bun scripts/snapshot-vector-iterations.ts`.

## Examined iterations

- Old grid: iterations 100 and 1,000 remained behind an earlier lane. At iteration 10,000, the search had produced a roughly 70 mm detour across an approximately 18 mm gap. See `iterations/grid-baseline`.
- Initial vector replacement: iteration 500 exposed incompatible handoff winding. Changing the search representation alone did not fix the input fanouts. See `iterations/vector-first`.
- Staggered obstacle case: iteration 4 follows an offset obstacle corner; iteration 8 commits the first detour and explores the next lane. Iteration 18 completes all three lanes with continuous, clearance-checked 45-degree bends. See `iterations/vector-final/obstacle-channel-*`.
- Final DDR cases: snapshots at iterations 0, 10, 30 and completion preserve all fixed copper, colored by layer. Left, right and top finish at iteration 36; bottom finishes at iteration 111. The left iteration-10 image shows partial carriers joining the unchanged fanouts; its final image completes the diagonal inner-layer bank alongside the straight lanes. Top and right retain continuous parallel carriers. Bottom uses continuous 45-degree bends between staggered banks. See `iterations/fast-routing`.

All four samples pass: 132/132 DDR connections, independent combined-copper DRC, and zero circuit errors in all four actual core builds. Measured solver times are 103 ms (bottom), 10 ms (left), 7 ms (right), and 8 ms (top). Including output DRC, the benchmark takes 127, 34, 40, and 42 ms respectively. Each sample has a one-second deadline. Clear channels use analytic shortest connectors before constructing any visibility graph; obstructed channels still use continuous clearance-offset geometry.

## Fanout provenance

All eight fanouts are exact, reproducible outputs of FanoutSolver 0.0.78. The right RAM uses official `connectionExitTargets` guidance from the SoC exits; top coordinates the SoC to the RAM. Bottom escapes the SoC through its left side into a bottom bank. Left locks successful layer assignments, preserves differential-pair winding, guides edge-pin escapes, and gives the RAM inner2 group a corner bank. These are solver inputs, not edits to generated route coordinates. All four layouts retain identical SoC ball positions and orientation, and the fanout regions have a 17.76 mm margin. The bus router sweeps the outside of each bend first, following terminal winding. Input, options and complete output remain committed and are checked by exact reproduction tests.

The original fanout inputs explicitly enable `allowViaInPad`. That fabrication assumption is now preserved in sample metadata and supplied to independent DRC; it is not a waiver of trace/via spacing checks. Interconnect routing itself never creates vias.

## Limits

A visibility-graph search failure is not a proof of planar impossibility. The router has bounded winding retries. Length tuning uses collision-checked chamfered detours; impedance uses a caller-provided width/impedance calibration. Neither is an electromagnetic simulation or complete DDR timing closure. Coupled differential geometry is rejected rather than silently ignored.
