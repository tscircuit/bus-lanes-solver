# Routing fixtures

`two-fanouts/` contains the four current AM62L phase inputs. Each contains 33 DDR
connections and 66 paths from real fanout-solver 0.0.78 outputs. Provenance lives
in `examples/fanout-solver-outputs`; the `.meta.json` files reference and hash it.
All four come from completed core builds with zero circuit errors. The current
score is 4/4, including combined-copper DRC, exact endpoints, immutable fixed
fanouts and no new layer transitions. The default solve deadline is one second.

The older root-level byte/CA prefix fixtures and raw negative captures remain
for regression history. Prefix fixtures are excluded from the default score.
