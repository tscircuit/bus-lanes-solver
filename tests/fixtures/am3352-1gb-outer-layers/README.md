# AM3352 1 GB outer-layer routing timeout

This case preserves the exact native input from a discrete AM3352/1 GB DDR3L
board's initial routing tests with `@tscircuit/bus-lanes-solver` **0.0.35**.
It records a search timeout, not a demonstrated unroutable board or a solver
exception. No routing fix, manual copper, changed placement or relaxed rule is
included.

`input.simple-route.json.gz` decompresses to the original 488,290 input bytes.
Its gzip timestamp is zero and it contains no original filename. The loader
checks both compressed and uncompressed SHA-256 hashes before parsing; it does
not construct or step a solver. Preserve the original bytes and connection IDs.

The capture contains 50 two-terminal DDR connections and all 420 circular
TOP-pad obstacles: 324 CPU pads and 96 RAM pads. U1 remains at `(0, 0)` mm with
zero rotation; U2 remains at `(0, -27)` mm with 270° counterclockwise rotation.
There are four physical copper layers, with signal carriers restricted to
`top` and `bottom`. Traces are 0.1016 mm wide and through vias use 0.45 mm copper
lands / 0.25 mm holes. Blind/buried vias and via-in-pad are disabled.

The four buses partition all 50 signals: two 11-member byte buses, the 27-member
address/control/clock bus, and RESET. Byte planar-length maxima are 27.4 mm and
29.8 mm, derived from the actual placement's Manhattan baselines. The CA/CK
nominal planar-length band is 35.35–37.89 mm, with a 36.62 mm target. Byte and
CA/CK skew limits are 0.635 mm; both DQS pairs and CK retain 0.127 mm pair skew
and the provisional 0.12 mm edge gap. These are captured constraints, not
verified impedance or physical flight-time results.

The input includes **no fixed power fanouts, decoupling, existing trace copper,
or GND/VDDS_DDR pours**. Keeping inner layers out of the signal router does not
create reference planes. This is the unpowered signal-geometry case; it must
not be described as a completed TI-compliant DDR layout or confused with the
repository's powered AM3352 benchmark fixtures.

## Observed runs

Both records used the same input bytes and native options `{ goal: "matched" }`.

| Record | Observed elapsed time | Iterations | Final phase | Accepted routes |
| --- | ---: | ---: | --- | ---: |
| `observed-result-001.json` | 240.044 s | 692,566 | `route_shared_layers` | 0 |
| `observed-result-002.json` | 1,200.001 s | 3,715,684 | `route_shared_layers` | 0 |

Both reached their wall-time budgets with `solved: false`, `failed: false`, and
null native error/failure code. The two result files and test-002 metadata are
copied byte for byte. Future versions may solve this case; a fast fixture test
must not require the historical timeout to persist.

`provenance.json` records input/package hashes, the original signal-name map's
physical port endpoints, capture scope, and the source checkout used while
archiving. The observed installed bundle is pinned by its 0.0.35 package URL
and SHA-256. Its package metadata contains no source commit, so these historical
results do not establish performance of the later source checkout. The original
run records did not record a runtime version; the version observed while
archiving is identified separately. These timings are not a controlled
base/head benchmark comparison.

The original placement JSON is not included as an unrouted snapshot. Its hash
and all 50 physical endpoint pairs are retained as provenance. Empty debug
graphics and unrouted/intermediate images are intentionally excluded.

Use the opt-in reproduction runner at
[`scripts/repro-am3352-1gb-outer-layers.ts`](../../../scripts/repro-am3352-1gb-outer-layers.ts)
to investigate this unchanged input. A bounded source-checkout run is:

```sh
bun scripts/repro-am3352-1gb-outer-layers.ts --steps 10000 --seconds 30
```

To use the original published bundle, download the pinned package separately.
The runner verifies the recorded `dist/index.js` SHA-256 before importing it:

```sh
am3352_repro_package="$(mktemp -d)"
curl --fail --location \
  https://jscdn.tscircuit.com/@tscircuit/bus-lanes-solver/0.0.35.tgz \
  --output "$am3352_repro_package/package.tgz"
tar -xzf "$am3352_repro_package/package.tgz" -C "$am3352_repro_package"
bun scripts/repro-am3352-1gb-outer-layers.ts \
  --recorded-bundle "$am3352_repro_package/package/dist/index.js" \
  --steps 10000 --seconds 30
```

An explicit replay with the original 20-minute wall-time budget uses
`--steps 8000000 --seconds 1200`. Wall time and iteration throughput depend on
the runtime and machine; use `--output-directory` to retain a separate result
record. The default output directory is under the ignored `.cache` directory.

Loading the fixture is a separate, solver-free integrity check. Long fresh
solves and any routing changes require their own validation; no successful
route or benchmark improvement is claimed by adding this case.

The CLI exits 0 for native completion with unchanged input, 2 for a diagnostic
step/time budget stop, and 1 for a native failure, worker error or provenance
mismatch. Any input mutation is an integrity failure even when a budget expires.
Local-source reports include the checkout revision and whether `lib/` has
working-tree changes. The parent also bounds a worker stuck inside a synchronous step, with
a five-second shutdown allowance. Diagnostic JSON and logs are written locally;
the command does not export route snapshots or claim electrical acceptance.

For interactive source debugging, run `bun start` and select
`am3352-1gb-outer-layers` in Cosmos. The page verifies the decompressed input hash
in the browser. Its fallback view is explicitly an input-pad/ratsnest diagnostic.
Use the debugger controls to step or run the current source implementation.
