This native input isolates AM3352 HDMI pair source_trace_824/source_trace_826,
its ESD package and the HDMI connector. Prior DDR, other packages and all prior
copper are omitted to make a focused input-only case. Every test freshly routes
the pair. Original 0.10 mm gap and 0.127 mm skew remain unchanged.

One input describes the HDMI rectangles with a 90-degree rotation. The second
uses their identical board-world axis-aligned extents. Copper and endpoints are
physically equivalent. A correct package-handoff calculation must produce the
same route for both representations. This is a test-input transformation; no
actual board or generated Circuit JSON is post-processed.
