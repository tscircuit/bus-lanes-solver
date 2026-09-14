import url from "../tests/fixtures/two-fanouts/ddr_top_io_bottom.json?url"
import metadataUrl from "../tests/fixtures/two-fanouts/ddr_top_io_bottom.meta.json?url"
import { FixtureLoader } from "./fixture-view"
export default (
  <FixtureLoader
    url={url}
    metadataUrl={metadataUrl}
    title="AM62L / ddr top io bottom"
    description="33 DDR signals · 66 real FanoutSolver paths · 17.76 mm gap · fixed-copper DRC passes"
  />
)
