# H3 reference placement and net facts

This factual SRJ extraction comes from the placed/routed Allwinner H3 CPU–DDR3 reference layout in [hvwyl/allwinner-h3-ddr3-16x1-kicad](https://github.com/hvwyl/allwinner-h3-ddr3-16x1-kicad/tree/02e365b21363a17710e0f96072c0844940495567), commit `02e365b21363a17710e0f96072c0844940495567`.

The source [KiCad board](https://github.com/hvwyl/allwinner-h3-ddr3-16x1-kicad/blob/02e365b21363a17710e0f96072c0844940495567/project/allwinner-h3.kicad_pcb) has SHA-256 `4a1f99d157a4ed5dc15b2dff2fed9f3765226296c1da3930cdd00413254509bb`. This fixture preserves all 479 source pads, the native two copper layers, eleven byte-lane nets/endpoints, and source width/clearance/via rules. The CPU is U1, an H3 BGA347; DU1 uses a DDR3 FBGA96 footprint. The source's 1,252 segments and 119 vias were removed before extracting the unrouted experiment. No saved routing is used by either test or solver.

No manufacture, boot-tested hardware, or source-license claim is made. No license file was identified in the inspected source snapshot. The native CAD file is not copied into this repository; the fixture records extracted placement, pad, net and rule facts, with source attribution.

Noncircular source pads are represented by their conservative bounding rectangles. All 443 circular pads retain their exact radii. Existing copper and reference-plane reservations are absent; successful geometric routing does not establish impedance, return-path quality or electrical timing closure. The original DQ8 bus has no authored skew bound.

The unchanged fixture SHA-256 is `5f157c9638526056eefb3e5dda5e262e71f7c9bfd7baf2c4cd09b6418cea4a11`. Its metadata preserves the import assumptions and source design rules. Every source regression freshly solves it and independently checks physical endpoint connectivity, native circle/rectangle copper clearance and drill/pad intersections before accepting completed output.
