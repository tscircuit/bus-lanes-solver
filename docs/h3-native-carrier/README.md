# Fresh H3 native carrier reproduction

The original eleven-signal H3 CPU–DDR reference input leaves carrier layers unrestricted. The source fixture retains all 479 pads, two native copper layers, and source wire/via rules. The current router completes the DQ8 corridor but fails `no_planar_route` while routing the remaining DM/DQS signals, because generated approaches omit their legal native surface from the alternative carrier domain.

Run `bun test tests/pipeline-unrestricted-native-carrier.test.ts tests/h3-native-carrier-source.test.ts --timeout 9999999`. Each file contains one desired-behavior test. Run the ordinary tests first to see the incorrect completion result fail, then mark the same tests `test.failing` for the isolated reproduction. The stacked fix removes `.failing` without weakening the assertions.

The real source test freshly solves the fixture, compares its actual SVG against the committed [golden snapshot](result.snap.svg), then asserts successful completion. Normal test runs never write the golden. Update it only with `BUN_UPDATE_SNAPSHOTS=1 bun test tests/h3-native-carrier-source.test.ts --timeout 9999999` or the explicit CLI `bun scripts/export-h3-native-carrier-snapshot.ts --allow-failed`.

This explicitly requested reproduction golden is labelled **FAILED / UNACCEPTED**, with no accepted output and no claimed DRC pass. Visible partial copper is the solver's failed preview, not saved routing or a successful artifact. The stacked fix replaces this same golden path with actual completed routing, guarded by physical connectivity, native copper DRC and drill/pad checks. Imported runner code has no filesystem writes.

See [source attribution and import limits](../../tests/fixtures/h3-native-carrier/PROVENANCE.md). This reference is not established as manufactured or boot-tested hardware. The original bus has no skew bound; these tests do not claim DDR electrical timing closure.

Benchmark effect: no routing code changes in the isolated reproduction. The full fresh paired eleven-case AM3352 Blacksmith comparison remains required before merge, using 3,600 seconds per solver/sample. Local expected-failure repro tests and the H3 experiment do not establish that benchmark acceptance or performance.
