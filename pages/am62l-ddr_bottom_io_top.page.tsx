import url from "../tests/fixtures/two-fanouts/ddr_bottom_io_top.json?url"
import metadataUrl from "../tests/fixtures/two-fanouts/ddr_bottom_io_top.meta.json?url"
import { FixtureLoader } from "./fixture-view"
export default (
  <FixtureLoader
    url={url}
    metadataUrl={metadataUrl}
    title="AM62L / ddr bottom io top"
    description="Actual DDR_INTERCONNECT phase input: 33 signals between real FanoutSolver SoC and RAM outputs, with a 17.76 mm gap between their enclosing regions. All carrier traces are absent at iteration 0. All copper is colored by layer; the bus_lanes phase adds only the interconnect between the fanouts."
  />
)
