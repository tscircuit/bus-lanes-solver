import url from "../tests/fixtures/two-fanouts/ddr_bottom_io_top.json?url"
import metadataUrl from "../tests/fixtures/two-fanouts/ddr_bottom_io_top.meta.json?url"
import { FixtureLoader } from "./fixture-view"
export default (
  <FixtureLoader
    url={url}
    metadataUrl={metadataUrl}
    title="AM62L / ddr bottom io top"
    description="Actual DDR_INTERCONNECT phase input: 33 signals between independent SoC and RAM fanouts, with a 6 mm gap between their enclosing regions. All carrier traces are absent at iteration 0. Fixed fanout copper is gray; colored traces are generated only by bus_lanes."
  />
)
