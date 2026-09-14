# Routing fixtures

`two-fanouts/` contains the four current AM62L phase inputs. Each contains 33 DDR
connections and 66 paths from real fanout-solver 0.0.78 outputs. Provenance lives
in `examples/fanout-solver-outputs`; the `.meta.json` files reference and hash it.
All four come from completed core builds with zero circuit errors. The current
score is 4/4, including combined-copper DRC, exact endpoints, immutable fixed
fanouts and no new layer transitions. The default solve deadline is one second.

The older root-level byte/CA prefix fixtures and raw negative captures remain
for regression history. Prefix fixtures are excluded from the default score.

The current phase captures include an explicit 0.1 mm maximum length skew for each logical DDR bus. Pass criteria include total planar copper length matching across both fanouts and each carrier, not only connectivity and DRC.
