# Paired centerline shortening repro

`routeCoupledPair` returns `null` for a routable, almost-horizontal pair in an
empty scene. This fixture reduces a corridor encountered while routing the
AM3352 SBC; it does not require that board, a network connection, or installed
packages. Bun runs the test's repository-local imports directly.

```sh
bun test tests/coupled-offset-shortening.test.ts
```

Reproduced on upstream `d8583e433b5268ef4472639a18a533f2ba55e453` with
Bun 1.4.0 (`34cbb9a40`): **2 passing controls, 1 failing regression**. The failing
assertion expects the native generator to return traces instead of `null`.
This is intentionally a repro PR; no routing algorithm changes are included.

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

As a diagnostic, applying the previously retained offset-aware shortening patch
to an isolated source copy makes this same test pass all three cases and 86
assertions. That patch checks both offset conductors before accepting a shorter
centerline. It is not applied by this PR.

This correctness repro is separate from the current AM3352 DDR VREF topology
timeout in capacity-autorouter. It makes no claim that the full board is routed.

## Validation

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
control placement; no routing snapshots are included in this repro PR.
