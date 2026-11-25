This fixture is the unchanged input produced by Core's built-in bus-lanes adapter for `tests/fixtures/h616-ddr3.tsx` in the stacked Core repro/fix PRs. It contains 53 electrical nets, all 384 original pads, selected CPU-to-RAM clock paths and zero supplied traces. It is solved in one phase with default solver options. No routing callback or benchmark-specific input adjustment is used.

Core baseline: `6a619d5725afa290e3ee56900bb15681405f7395`, plus the existing-API lengthMatchTo fix.

TSX SHA-256: `aa068e9e02427f0ea4285800c3c83a2585c88a35c935e53b6c836517512d806b`.

The test reuses the original nine timing rules and six preservation checks from `unrouted.json.gz`. Measurement follows the selected clock paths and excludes termination stubs. Original footprint geometry and timing tolerances are unchanged.
