# Vector routing audit

The previous raster search has been removed. The router now builds a visibility graph from the corners of clearance-offset copper. Each graph edge is an analytic horizontal, vertical, or 45-degree polyline. Collision predicates operate on continuous segments, rectangles and via disks; there is no cell size or coordinate stepping. Terminal fields are swept perpendicular to the channel direction, grouped by layer, with alternate winding orders on failure.

Snapshots are reproducible with `bun scripts/snapshot-vector-iterations.ts`.

## Examined iterations

- Old grid: iterations 100 and 1,000 remained behind an earlier lane. At iteration 10,000, the search had produced a roughly 70 mm detour across an approximately 18 mm gap. See `iterations/grid-baseline`.
- Initial vector replacement: iteration 500 exposed incompatible handoff winding. Changing the search representation alone did not fix the input fanouts. See `iterations/vector-first`.
- Staggered obstacle case: iteration 4 follows an offset obstacle corner; iteration 8 commits the first detour and explores the next lane. Iteration 18 completes all three lanes with continuous, clearance-checked 45-degree bends. See `iterations/vector-final/obstacle-channel-*`.
- Right-facing DDR: snapshots at iterations 0, 10, 30 and 50 preserve all fixed copper. Iteration 69 completes all 33 interconnects. The core build reports zero circuit errors and the independent combined-copper DRC passes.

## Fanout provenance

The right RAM fanout was rerun with the official `connectionExitTargets` API, using the real SoC exits and their layers. The generated exit alignment is intentional behavior of FanoutSolver; no output coordinates were edited. Input, options and complete output remain committed and reproducible. Other orientations retain their original evidence until replacement fanouts succeed and pass independent checks.

The original fanout inputs explicitly enable `allowViaInPad`. That fabrication assumption is now preserved in sample metadata and supplied to independent DRC; it is not a waiver of trace/via spacing checks. Interconnect routing itself never creates vias.

## Limits

A visibility-graph search failure is not a proof of planar impossibility. The router has bounded winding retries. Length tuning uses collision-checked chamfered detours; impedance uses a caller-provided width/impedance calibration. Neither is an electromagnetic simulation or complete DDR timing closure. Coupled differential geometry is rejected rather than silently ignored.
