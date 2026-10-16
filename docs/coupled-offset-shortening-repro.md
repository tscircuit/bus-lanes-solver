# Paired centerline shortening repro

Before the fix, `routeCoupledPair` returned `null` for a routable,
almost-horizontal pair in an empty scene. This fixture reduces a corridor
encountered while routing the AM3352 SBC; it does not require that board, a
network connection, or installed packages. Bun runs the test's repository-local
imports directly.

```sh
bun test tests/coupled-offset-shortening.test.ts
```

Reproduced on upstream `d8583e433b5268ef4472639a18a533f2ba55e453` with
Bun 1.4.0 (`34cbb9a40`): **2 passing controls, 1 failing regression**. The failing
assertion expects the native generator to return traces instead of `null`.
The original repro PR intentionally contains a failing regression and no
routing algorithm changes.

## Fixture

- Two connections, two terminals each; no obstacles or fixed copper.
- Two layers, with both conductors on top; 0.1 mm width, 0.18 mm pair gap,
  and 0.1 mm clearance.
- Corridor endpoints retain their original decimals. Their Y difference is
  approximately 0.000886 mm. Rounding them can change connector selection.
- Synthetic terminals extend each end by the native 0.48 mm handoff margin,
  so `routeCoupledPair` computes the original corridor endpoints itself.

## Failure and expected behavior

The centered four-point connector is visible and produces two valid conductors
when offset by ±0.14 mm. Ordinary shortening replaces it with a visible
three-point centerline. Offsetting that shortcut makes one conductor reverse
direction and form a 135-degree corner. Its self-clearance check still passes;
this repro does not establish a copper self-short.

The paired caller should retain an alternative whose **two offset conductors**
remain valid. The regression expects two traces with exact terminal coordinates,
finite top-layer wires, valid turns, clearance, shared spacing, coupling, and
length skew. A separate control preserves ordinary shortening's existing
behavior.

The stacked fix adds an optional candidate guard to `reduceOrdinaryTurns`.
The paired caller checks conventional angles and self-clearance on both offset
conductors. Shortening preserves valid conductors while allowing progressive
repair of paths that already have defects. Ordinary callers retain their
existing behavior; input simplification and fallback still pass through the
caller's final routing checks. This same test now passes all three cases and
86 assertions without changing the repro fixture or relaxing its checks.

This correctness repro is separate from the current AM3352 DDR VREF topology
timeout in capacity-autorouter. It makes no claim that the full board is routed.

## Original repro validation

Type checking (`tsc --noEmit`) passes. The repository's control benchmark was
also run on unchanged routing code:

```sh
./benchmark.sh --worker control --timeout-seconds 180
```

It completed 47/47 signals with connectivity, DRC, and matching passing, in
42.586 seconds of solving / 44.353 seconds total. Both DDR byte buses reported
approximately 0.635 mm total copper length skew (0.635 mm tolerance); the three
pairs reported 0.077868, 0.126884, and 0.072830 mm (0.127 mm tolerance). Original
input and fixed power fanouts remained unchanged. Benchmark scope is the
control placement; no routing snapshots were included in the original repro PR.

## Fix validation

The unchanged repro passes all three tests (86 assertions). A separate real-obstacle
regression covers progressive repair of two initially invalid corner groups.
The focused suite passes 25 tests and 260 assertions; type checking passes.

All eleven native AM3352 benchmark samples pass connectivity, full DRC and
total-length matching with their original inputs and 161 fixed power fanouts
preserved. See [per-bus skew, runtime and inspected native snapshots](coupled-offset-shortening-fix/README.md).


## Benchmark coverage

The exact reduced input is also a default benchmark case named
`coupled-offset-shortening`, appended after the eleven AM3352 placements.
The shared manifest includes it in future main-versus-PR `/benchmark` runs
once the updated trusted harness is merged into `main`.

```sh
./benchmark.sh --worker coupled-offset-shortening --timeout-seconds 5 --require-all-solved
```

The worker uses the selected revision’s public pipeline with `fanout: "none"`;
`--solver /path/to/revision/lib/index.ts` selects that revision’s router.
Running this harness against the pre-fix repro revision fails natively; the fix
passes both signals, DRC, connectivity, coupling and length matching. Failed
searches remain measured failures; `--require-all-solved` also makes an unsolved
direct worker exit nonzero. See [reduced-case measurements and completed snapshot](coupled-offset-shortening-fix/README.md#reduced-case-in-the-default-benchmark).
