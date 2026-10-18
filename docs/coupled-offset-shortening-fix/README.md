# Completed native routing benchmarks

Evidence for the coupled-offset shortening fix stacked on [repro PR #58](https://github.com/tscircuit/bus-lanes-solver/pull/58).

The original 11 AM3352 cases completed through the official benchmark worker using Bun 1.4.0 `--smol`. The serial controller preserves the native routing code, validation and 3600-second per-case solve limit. All eleven exported PNGs were opened and visually inspected.

These eleven-case measurements were captured for fix commit `e2f00b20a908dc8272b87a41069fabd50fe37ba9`; they are preserved unchanged.

The first eight samples used default JSC GC settings. The last three additionally used `BUN_JSC_forceRAMSize=2147483648` and `BUN_JSC_miniVMHeapGrowthFactor=1.05` for earlier garbage collection within the shared-memory limit. These are GC sizing settings; `gcMaxHeapSize` remains 0. Timings therefore reflect mixed GC configurations. [Source, input, route and image hashes](benchmark-provenance.json) record the settings for each sample.

[Complete native worker results](benchmark-results.json), SHA-256 `24d0d272125eb8fdacf2c158b4608458d57feca21a90b4ca470cc05a9a9be16c`. The capture is excluded from automatic formatting to preserve its original bytes.

## Connectivity, validation and runtime

| Sample | Signals | Full DRC | Total-length matching | Input | Fixed power fanouts | Solve (s) | Total case (s) | Native PNG |
|---|---:|---|---|---|---|---:|---:|---|
| control | 47/47 | PASS | PASS | unchanged | 161 unchanged | 40.075 | 41.916 | [view](control-solved.png) |
| control-inner1 | 47/47 | PASS | PASS | unchanged | 161 unchanged | 1594.381 | 1596.434 | [view](control-inner1-solved.png) |
| right | 47/47 | PASS | PASS | unchanged | 161 unchanged | 32.290 | 34.758 | [view](right-solved.png) |
| left | 47/47 | PASS | PASS | unchanged | 161 unchanged | 43.542 | 47.746 | [view](left-solved.png) |
| above | 47/47 | PASS | PASS | unchanged | 161 unchanged | 49.815 | 53.107 | [view](above-solved.png) |
| inner-layers | 47/47 | PASS | PASS | unchanged | 161 unchanged | 60.416 | 62.301 | [view](inner-layers-solved.png) |
| inner-layers-right | 47/47 | PASS | PASS | unchanged | 161 unchanged | 89.178 | 91.051 | [view](inner-layers-right-solved.png) |
| inner-layers-left | 47/47 | PASS | PASS | unchanged | 161 unchanged | 186.811 | 192.135 | [view](inner-layers-left-solved.png) |
| inner-layers-above | 47/47 | PASS | PASS | unchanged | 161 unchanged | 287.162 | 291.499 | [view](inner-layers-above-solved.png) |
| inner-layers-complete-ca | 47/47 | PASS | PASS | unchanged | 161 unchanged | 295.354 | 308.412 | [view](inner-layers-complete-ca-solved.png) |
| outer-layers | 47/47 | PASS | PASS | unchanged | 161 unchanged | 986.584 | 991.019 | [view](outer-layers-solved.png) |

Solve time is native `solveMilliseconds`; total case time is native `milliseconds`, including fixture loading and validation. These are measured case times, not a cross-machine performance comparison.

## Every bus: total planar copper length and skew

| Sample | Native bus ID | Members | Measured min (mm) | Measured max (mm) | Skew (mm) | Limit (mm) | Matched |
|---|---|---:|---:|---:|---:|---:|---|
| control | DDR_BYTE0 | 11 | 34.815944886 | 35.450944886 | 0.635000000 | 0.635000000 | PASS |
| control | DDR_BYTE1 | 11 | 32.338608408 | 32.973608419 | 0.635000010 | 0.635000000 | PASS |
| control-inner1 | DDR_BYTE0 | 11 | 32.413899645 | 33.048899645 | 0.635000000 | 0.635000000 | PASS |
| control-inner1 | DDR_BYTE1 | 11 | 32.369719838 | 33.004719838 | 0.635000000 | 0.635000000 | PASS |
| right | DDR_BYTE0 | 11 | 38.737924387 | 39.372924387 | 0.635000000 | 0.635000000 | PASS |
| right | DDR_BYTE1 | 11 | 46.048649612 | 46.683649612 | 0.635000000 | 0.635000000 | PASS |
| left | DDR_BYTE0 | 11 | 47.665415522 | 48.300415532 | 0.635000010 | 0.635000000 | PASS |
| left | DDR_BYTE1 | 11 | 54.054862243 | 54.566009068 | 0.511146825 | 0.635000000 | PASS |
| above | DDR_BYTE0 | 11 | 50.656465868 | 51.291465868 | 0.635000000 | 0.635000000 | PASS |
| above | DDR_BYTE1 | 11 | 56.763725396 | 57.398725396 | 0.635000000 | 0.635000000 | PASS |
| inner-layers | DDR_BYTE0 | 11 | 34.815944886 | 35.450944885 | 0.635000000 | 0.635000000 | PASS |
| inner-layers | DDR_BYTE1 | 11 | 31.958773450 | 32.593773461 | 0.635000011 | 0.635000000 | PASS |
| inner-layers-right | DDR_BYTE0 | 11 | 46.113187475 | 46.748187487 | 0.635000011 | 0.635000000 | PASS |
| inner-layers-right | DDR_BYTE1 | 11 | 42.856113527 | 43.491113527 | 0.635000000 | 0.635000000 | PASS |
| inner-layers-left | DDR_BYTE0 | 11 | 57.243274875 | 57.878265246 | 0.634990372 | 0.635000000 | PASS |
| inner-layers-left | DDR_BYTE1 | 11 | 60.358471881 | 60.993463912 | 0.634992030 | 0.635000000 | PASS |
| inner-layers-above | DDR_BYTE0 | 11 | 67.455466434 | 68.090457423 | 0.634990988 | 0.635000000 | PASS |
| inner-layers-above | DDR_BYTE1 | 11 | 72.481894734 | 73.116887449 | 0.634992715 | 0.635000000 | PASS |
| inner-layers-complete-ca | DDR_BYTE0 | 11 | 52.137330608 | 52.772320851 | 0.634990243 | 0.635000000 | PASS |
| inner-layers-complete-ca | DDR_BYTE1 | 11 | 50.297312552 | 50.932304237 | 0.634991684 | 0.635000000 | PASS |
| inner-layers-complete-ca | DDR_ADDR_CTRL_CK | 24 | 61.650542877 | 62.285537335 | 0.634994458 | 0.635000000 | PASS |
| outer-layers | DDR_BYTE0 | 11 | 42.174720650 | 42.809720661 | 0.635000011 | 0.635000000 | PASS |
| outer-layers | DDR_BYTE1 | 11 | 41.926277471 | 42.561277471 | 0.635000000 | 0.635000000 | PASS |

Measured min/max use the actual member `totalLengthMm` values, not requested length bounds. Native totals include supplied fixed copper plus the new carrier. Via depth and package delay are not inferred. Values are rounded to nine decimal places here; native matching uses its existing 1e-7 mm comparison tolerance.

## All three differential pairs

| Sample | Native pair ID | Original member names | Total skew (mm) | Limit (mm) | Matched |
|---|---|---|---:|---:|---|
| control | pair_0 | source_trace_15 / source_trace_16 | 0.077868325 | 0.127000000 | PASS |
| control | pair_1 | source_trace_27 / source_trace_26 | 0.126883732 | 0.127000000 | PASS |
| control | pair_2 | source_trace_32 / source_trace_33 | 0.072829653 | 0.127000000 | PASS |
| control-inner1 | pair_0 | source_trace_15 / source_trace_16 | 0.048899645 | 0.127000000 | PASS |
| control-inner1 | pair_1 | source_trace_27 / source_trace_26 | 0.004719838 | 0.127000000 | PASS |
| control-inner1 | pair_2 | source_trace_32 / source_trace_33 | 0.002791965 | 0.127000000 | PASS |
| right | pair_0 | source_trace_15 / source_trace_16 | 0.096046654 | 0.127000000 | PASS |
| right | pair_1 | source_trace_27 / source_trace_26 | 0.121802307 | 0.127000000 | PASS |
| right | pair_2 | source_trace_32 / source_trace_33 | 0.102643817 | 0.127000000 | PASS |
| left | pair_0 | source_trace_15 / source_trace_16 | 0.010514369 | 0.127000000 | PASS |
| left | pair_1 | source_trace_27 / source_trace_26 | 0.127000000 | 0.127000000 | PASS |
| left | pair_2 | source_trace_32 / source_trace_33 | 0.105428514 | 0.127000000 | PASS |
| above | pair_0 | source_trace_15 / source_trace_16 | 0.127000000 | 0.127000000 | PASS |
| above | pair_1 | source_trace_27 / source_trace_26 | 0.127000000 | 0.127000000 | PASS |
| above | pair_2 | source_trace_32 / source_trace_33 | 0.127000000 | 0.127000000 | PASS |
| inner-layers | pair_0 | source_trace_15 / source_trace_16 | 0.077868325 | 0.127000000 | PASS |
| inner-layers | pair_1 | source_trace_27 / source_trace_26 | 0.126883732 | 0.127000000 | PASS |
| inner-layers | pair_2 | source_trace_32 / source_trace_33 | 0.127000000 | 0.127000000 | PASS |
| inner-layers-right | pair_0 | source_trace_15 / source_trace_16 | 0.127000011 | 0.127000000 | PASS |
| inner-layers-right | pair_1 | source_trace_27 / source_trace_26 | 0.127000000 | 0.127000000 | PASS |
| inner-layers-right | pair_2 | source_trace_32 / source_trace_33 | 0.127000000 | 0.127000000 | PASS |
| inner-layers-left | pair_0 | source_trace_15 / source_trace_16 | 0.126990000 | 0.127000000 | PASS |
| inner-layers-left | pair_1 | source_trace_27 / source_trace_26 | 0.000000527 | 0.127000000 | PASS |
| inner-layers-left | pair_2 | source_trace_32 / source_trace_33 | 0.105428514 | 0.127000000 | PASS |
| inner-layers-above | pair_0 | source_trace_15 / source_trace_16 | 0.126915344 | 0.127000000 | PASS |
| inner-layers-above | pair_1 | source_trace_27 / source_trace_26 | 0.126989800 | 0.127000000 | PASS |
| inner-layers-above | pair_2 | source_trace_32 / source_trace_33 | 0.000000619 | 0.127000000 | PASS |
| inner-layers-complete-ca | pair_0 | source_trace_15 / source_trace_16 | 0.075358872 | 0.127000000 | PASS |
| inner-layers-complete-ca | pair_1 | source_trace_27 / source_trace_26 | 0.000000000 | 0.127000000 | PASS |
| inner-layers-complete-ca | pair_2 | source_trace_32 / source_trace_33 | 0.066383872 | 0.127000000 | PASS |
| outer-layers | pair_0 | source_trace_15 / source_trace_16 | 0.019219372 | 0.127000000 | PASS |
| outer-layers | pair_1 | source_trace_27 / source_trace_26 | 0.127000000 | 0.127000000 | PASS |
| outer-layers | pair_2 | source_trace_32 / source_trace_33 | 0.127000000 | 0.127000000 | PASS |

Images were generated by the native completed-route exporter after revalidating saved native successes. No intermediate, failed or unrouted snapshot is included. This report does not claim that the separate whole SBC is routed.


## Reduced case in the default benchmark

`coupled-offset-shortening` is now the twelfth case in both `./benchmark.sh`
and the shared `/benchmark` manifest. It uses the exact original fixture and
routes through each selected revision’s public pipeline with `fanout: "none"`.
The AM3352 placement list and its 47-signal/161-fixed-fanout validation stay unchanged.
The default-branch harness must include this change before GitHub `/benchmark`
will execute the new case.

```sh
./benchmark.sh --worker coupled-offset-shortening --timeout-seconds 5 --require-all-solved
```

The pre-fix repro revision `7726294d2948b2016ef2d416c87585f849fdf054`
failed natively with `coupled_routing_failed` (0/2 signals, 84.447 ms).
The unchanged routing code from fix commit `e2f00b20a908dc8272b87a41069fabd50fe37ba9`
passed with 2/2 signals in 68.263 ms (73.019 ms including loading/validation).
Both workers used the same new harness and input SHA-256
`4f0816b08e6b3a22ed58b686159f519aada2b472a3dcc6189cf427a0151b856f`.

Full native DRC, all four exact terminal joins, conventional turns, self-clearance,
continuous interconductor clearance, shared spacing, coupling and total-length
matching pass. P and N each measure 1.394330593 mm; pair skew is 0 mm against
0.127 mm. There are no buses or fixed power fanouts in this reduced case.

[Worker report](reduced-case-benchmark.json) preserves the native report values
with formatting for readability. The [completed native PNG](coupled-offset-shortening-solved.png) and
[SVG](coupled-offset-shortening-solved.svg)
were revalidated before export; the PNG was opened for visual inspection. The successful
route came directly from the worker, without copper edits. The added run uses
Bun 1.4.0 with the earlier-GC settings described above. This separate measurement
does not turn the historical eleven-case capture into a new twelve-case aggregate.
