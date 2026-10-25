# Native SMT pair corridor

Two AM3352 HDMI connector signals after native DogboneAutorouter fanout
with the rectangular-pad edge-site fix in fanout-solver #259. The native
four full-stack via sites have 0.30 mm drills and 0.50 mm lands. The original
0.127 mm skew tolerance and 0.18 mm pair gap remain unchanged.

The capture retains both complete physical pad fields and the four fixed
fanouts; distant components and unrelated prior-phase copper were removed
only to isolate this solver regression. No signal route was manually drawn.

The regression expects a fresh complete solve within 20,000 pipeline steps
and 60 seconds. The dedicated Blacksmith workflow compares pinned base/head
using this same fixture, checks and budgets. This focused budget is separate
from the required 3,600-second-per-case, 11-sample legacy benchmark.

The routed SVG shows the valid target produced by the stacked fix, not a
successful baseline. Its exporter refuses incomplete, disconnected, DRC-invalid,
unmatched or terminal-via-shortcut results. The two complete joined signals
also passed independent checks 0.0.256 locally.
