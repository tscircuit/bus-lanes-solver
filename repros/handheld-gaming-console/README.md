# Handheld Gaming Console — routed stack preview

Combines clean repro #194 and standalone fix #195. Both PRs target main directly.
Never merge: this stack is for review and validation only.

![Fresh validated connectivity result](board.snap.svg)

[Failed version of the same snapshot](https://github.com/tscircuit/bus-lanes-solver/blob/212a384048e03a315bda33dd20056cf9df066ace/repros/handheld-gaming-console/board.snap.svg).

Run the fresh-solve regression:

    bun test ./tests/handheld-routing-snapshot.test.ts

The same immutable fixture and snapshot path are used on both revisions.
The repro expects the stock failure and shows its hashed, recorded unaccepted
candidates. The fix expects a fresh solve and validates all 65 endpoints,
copper clearance, drill spacing and self-clearance before comparing the SVG.
No saved routes seed either solve. The capture is retained for provenance;
it is never consumed by a successful solve.

    bun repros/handheld-gaming-console/routing-snapshot.ts

The runner has a 600-second cooperative budget in this preview. Existing
baseline.json, input.snap.svg and cpu-escape.snap.svg describe the historical
stock failure. The original eight-layer native board, input and baseline remain
preserved; the active routing fixture uses six physical layers.

The routed result is connectivity-only. DDR group matching and differential
coupling remain unresolved; this is not manufacturing approval.

The production solver files match #195. The required paired AM3352 benchmark
must compare all eleven cases against pinned main before claiming no regression.
