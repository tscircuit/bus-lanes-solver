# Reference-plane crossing reproduction

One bottom-layer signal crosses a foreign supply trace on `inner2`. Copper DRC
correctly accepts those conductors on separate layers, but the signal loses its
declared GND reference where the supply displaces the GND pour.

This is an **input-model / electrical-constraint feature gap**, not a failure to
honor an existing same-layer clearance constraint. `SimpleRouteJson` currently
has no reference-net assignment, reference-layer assignment, or reference-copper
coverage geometry. The solver cannot infer which different-layer copper is an
acceptable reference from the supplied routing data.

## Run

From the repository root:

```sh
bun test tests/repros/reference-plane-crossing.test.ts
bun repros/reference-plane-crossing/run.ts
```

Verified on unmodified solver source at
`cbd27db2e7de5697d24fc63928c43fb92d3431d1` (package version `0.0.61`), with Bun
`1.4.4`. All four focused tests pass. They characterize the missing constraint;
they do not claim the baseline route meets the electrical requirement.

| Case | Solver completes | Native copper DRC | Independent reference check |
| --- | --- | --- | --- |
| Supplied inner2 power only | Yes | Pass | Fail |
| Projection on top instead of bottom | Yes | Pass | Fail |
| Supplied projection on bottom | Yes | Pass | Pass |

The fixture requests one 0.10 mm signal from `(-4, 0)` to `(4, 0)` on bottom.
A fixed 0.20 mm supply runs from `(0, -1)` to `(0, 1)` on inner2. The declared
reference is an otherwise continuous GND plane on inner2, cleared 0.155 mm from
the supply. Its missing-coverage region is therefore an exact round-ended band
of radius `0.20 / 2 + 0.155 = 0.255 mm`.

`check-reference-coverage.ts` computes segment-to-segment distances independently
of solver geometry and native DRC. It includes the signal's half-width and rejects
empty output. The baseline has a signed edge clearance of `-0.305 mm` to the
missing-coverage region. The positive control supplies a conservative rectangular
projection enclosing that region; the stock solver routes around it with at least
0.10 mm of additional clearance. All endpoints, bottom-layer restriction, and
fixed supplied copper are checked. No saved routing output is used as a solve.

The inner2 GND geometry is an explicit analytic assumption of this small fixture,
not a materialized pour imported from a PCB. This isolates the missing constraint
without requiring a whole board, a PCB converter, or an impedance model. It does
not establish the electrical adequacy of a particular return-current detour,
reference change, stitching capacitor, or fabrication stack.

## Real-board provenance

`board-provenance.json` retains only three relevant inner2 supply polylines and
hashes of their source evidence. In that partial four-layer AM3352 candidate
field, projecting supply routes `root31_v1v8_carve_5`, `_7`, and `_8` into the
bottom reference reservation rejected 127 of 147 previously generated DDR CA
candidates. Nine nets then had no remaining candidate. Those counts describe
candidate filtering, not a proof that the board was unroutable or completed.

The real-board filter also used a 0.10 mm conservative reference-planning margin.
That margin is not a JLC fabrication rule. The reproduction's independent check
tests the actual analytically defined coverage band; its positive-control
obstacle search also adds the ordinary 0.10 mm obstacle margin.

No failed or intermediate AM3352 images are included.

## API follow-up

A general solution needs the caller to declare acceptable references rather than
assuming that every foreign inner-layer trace must block every outer signal:

1. Associate protected connections and signal layers with acceptable reference
   layers and nets. A power plane can be an intentional reference in some designs.
2. Supply materialized reference-copper coverage, including voids and disjoint
   regions, after higher-priority pours and inner-layer traces are considered.
3. Derive signal-layer search restrictions from the **complement of acceptable
   coverage**, with a separately named electrical margin. Keep those restrictions
   distinct from physical copper and fabrication clearance.
4. Recompute reservations when later power routing or pour refill changes the
   coverage. Revalidate already-routed protected signals, not only the next solve.
5. Validate the final materialized reference geometry independently. Any permitted
   reference transitions need explicit policy and engineering qualification.

For a fixed plane cut, the existing obstacle API already provides the search
mechanism demonstrated by the positive control. This reproduction does not add
a production heuristic or silently broaden same-layer copper DRC into an SI
claim. A follow-up API change can generalize the projection once coverage and
transition semantics are agreed.

Benchmark effect: no production solver code, dependencies, or existing benchmark
fixtures change. These focused fresh solves do not replace the repository's
required paired benchmark comparison and 11-sample AM3352 CI acceptance before
merge. No benchmark speedup or whole-board routing completion is claimed.
