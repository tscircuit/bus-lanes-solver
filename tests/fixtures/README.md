The default benchmark uses `two-fanouts/*.json`: actual SRJs captured from the
DDR_INTERCONNECT phase of the circuits in `examples`. Both fanouts already exist;
no carrier traces exist. Metadata contains fixed paths, enclosing regions, and
build/DRC results. See `examples/README.md` for reproduction.

The files directly in this directory are legacy captures. `*-raw.json` are
mixed-layer negative tests; the byte/CA files reconstruct old carrier prefixes
and are excluded from the default benchmark. See `DATASET-AUDIT.md`.
