The inspected SVG shows the four freshly solved guarded CPU USB carriers in
board-world XY mm (+Y up). It is an expected-result preview for the stacked
fix, not evidence that the failing reproduction branch passes. The prior DDR
and fanouts are omitted from this focused illustration; they remain immutable
solver input. This is not a snapshot of a completed AM3352 board.

Local base: 73.99 s, solver success but terminal-via safety assertion fails for
source_trace_703. Isolated guarded solve: 82.80 s / 42,159 steps, four carriers,
all original pair-skew checks and configured coupling checks pass, no terminal
via shortcuts. These observations used shared hardware and differing concurrent
loads, so they do not establish a speed change. Independent whole-signal checks
also find the base shortcut and accept the guarded candidate. Exterior package
spacing remains a separate board-quality concern, not claimed resolved here.

The dedicated Blacksmith workflow freshly measures pinned base/head with the
same harness, fixture and one-hour budgets. The existing 11/11 AM3352 workflow
also remains mandatory. Pending reports are not benchmark passes.
