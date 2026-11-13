# Handheld connectivity stack preview

This review-only fix is stacked on repro #194. Its Files changed view replaces
the failed test-output snapshot with the freshly routed result at the same path:
`tests/__snapshots__/handheld-routing-snapshot.snap.svg`.

The standalone fix #195 still targets main. Neither PR is authorized to merge.
The former main-based preview is preserved on
`archive/handheld-stack-before-snapshot-diff`.

Run from the repository root:

    bun test tests/handheld-routing-snapshot.test.ts

The test uses the same `toMatchSvgSnapshot(import.meta.path)` matcher as existing
repros. Both revisions freshly solve the unchanged six-layer fixture. No saved
routes seed the solve. The failed state labels diagnostic candidate copper as
unaccepted; the fixed state requires all 65 signals, endpoint continuity, copper
clearance, drill spacing and self-clearance to pass before producing the image.

The general solver changes contain no handheld names, coordinates or saved
routes. DDR group length matching, differential coupling and timing remain
unresolved. No manufacturing readiness is claimed.

Both fresh snapshot tests and typechecks passed locally. Full paired AM3352
benchmark validation remains pending; no regression-free or speedup claim
is made. This snapshot-workflow change does not alter production solver code.
