# Handheld connectivity fix: failed board to routed board

This is the same immutable six-layer fixture used by clean repro #194.
The original native board, historical eight-layer input and source provenance
archive remain in that PR. This standalone fix targets main directly.

![Fresh validated connectivity result](board.snap.svg)

[Compare the failed snapshot](https://github.com/tscircuit/bus-lanes-solver/blob/212a384048e03a315bda33dd20056cf9df066ace/repros/handheld-gaming-console/board.snap.svg).

Run the fresh-solve regression:

    bun test ./tests/handheld-routing-snapshot.test.ts

The test never seeds saved routes. It solves all 65 signals, checks endpoints,
copper DRC, drill spacing and self-clearance, then compares the freshly rendered
SVG against the same board.snap.svg path used by the failed repro. The expected
state changes from failed in #194 to solved here; changing the expectation
without fixing the solver fails the test.

To regenerate the snapshot after a deliberate solver change:

    bun repros/handheld-gaming-console/routing-snapshot.ts

Only connectivity is approved by this test. Group length matching and pair
coupling still fail; this is not a DDR timing or manufacturing sign-off.

The captured failed candidates are only used in the repro revision, after its
fresh stock solve fails. The fix does not load or replay those candidates.
