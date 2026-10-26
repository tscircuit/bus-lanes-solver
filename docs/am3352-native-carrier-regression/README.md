# AM3352 native-carrier regression

All eleven declared canonical samples were freshly solved using solver commit `ec82ec2442d6c03f680d3f9735b94877a3e83559` and the unchanged base controller/fixtures at `f3f475386e2ec0eb5211d2392c1cfa53e4c2177e`, Bun 1.4.3, 3 concurrent local workers and 3,600 seconds per solver/sample. Every route connects 47/47 signals and passes independent combined-copper DRC, full-copper bus/pair matching, pair coupling and preservation of all 161 fixed power dogbones. Each canonical input retains all 420 CPU/RAM pad obstacles and four physical copper layers. These are package-placement regressions, not a complete SBC or electrical timing signoff.

The same fresh route records supply the images; no second solve or stored historical route was substituted. Rendering revalidates those records against the pinned base fixture/validator and draws only completed native copper on all physical layers. The local concurrent timings below are artifact-generation observations, not a paired performance comparison. The final-head hosted Blacksmith base/head comparison must be reported separately. All eleven PNGs were individually opened and visually inspected by two reviewers; a third reviewer checked the four most constrained placements. No visual blockers were found. Review status and image hashes are recorded in artifact-manifest.json.

| Sample | Local solve s | Connected | DRC issues | Bus XY skews mm | Pair XY skews mm |
|---|---:|---:|---:|---|---|
| [control](control.png) | 100.519 | 47/47 | 0 | 0.635000 / 0.635000 | 0.077868 / 0.126884 / 0.072830 |
| [control-inner1](control-inner1.png) | 1444.826 | 47/47 | 0 | 0.635000 / 0.635000 | 0.048900 / 0.004720 / 0.002792 |
| [right](right.png) | 57.484 | 47/47 | 0 | 0.635000 / 0.635000 | 0.096047 / 0.121802 / 0.102644 |
| [left](left.png) | 73.169 | 47/47 | 0 | 0.635000 / 0.511147 | 0.010514 / 0.127000 / 0.105429 |
| [above](above.png) | 93.725 | 47/47 | 0 | 0.635000 / 0.635000 | 0.127000 / 0.127000 / 0.127000 |
| [inner-layers](inner-layers.png) | 125.393 | 47/47 | 0 | 0.635000 / 0.635000 | 0.077868 / 0.126884 / 0.127000 |
| [inner-layers-right](inner-layers-right.png) | 206.656 | 47/47 | 0 | 0.635000 / 0.635000 | 0.127000 / 0.127000 / 0.127000 |
| [inner-layers-left](inner-layers-left.png) | 368.691 | 47/47 | 0 | 0.634990 / 0.634992 | 0.126990 / 0.000001 / 0.105429 |
| [inner-layers-above](inner-layers-above.png) | 481.376 | 47/47 | 0 | 0.634991 / 0.634993 | 0.126915 / 0.126990 / 0.000001 |
| [inner-layers-complete-ca](inner-layers-complete-ca.png) | 559.503 | 47/47 | 0 | 0.634990 / 0.634992 / 0.634994 | 0.075359 / 0.000000 / 0.066384 |
| [outer-layers](outer-layers.png) | 2067.292 | 47/47 | 0 | 0.635000 / 0.635000 | 0.019219 / 0.127000 / 0.127000 |

Worker command (each sample in a fresh process, original controller checkout):

```sh
bun scripts/benchmark.ts --worker SAMPLE --timeout-seconds 3600 --solver FINAL_SOLVER_CHECKOUT/lib/index.ts --routes-directory ACCEPTED_ROUTES
```

Source references, fixture/input/output hashes, fixed-fanout generator provenance and image hashes are retained in [artifact-manifest.json](artifact-manifest.json). Full local validation reports are in [benchmark-results.json](benchmark-results.json).
