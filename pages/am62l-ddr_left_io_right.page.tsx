import url from "../tests/fixtures/two-fanouts/ddr_left_io_right.json?url"
import metadataUrl from "../tests/fixtures/two-fanouts/ddr_left_io_right.meta.json?url"
import { FixtureLoader } from "./fixture-view"
export default (
  <FixtureLoader
    url={url}
    metadataUrl={metadataUrl}
    title="AM62L / ddr left io right"
    description="33 DDR signals · 66 real FanoutSolver paths · 17.76 mm gap · fixed-copper DRC passes"
  />
)
