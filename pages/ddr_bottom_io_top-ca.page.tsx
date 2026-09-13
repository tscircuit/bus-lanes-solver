import url from "../tests/fixtures/ddr_bottom_io_top-ca.json?url"
import { FixtureLoader } from "./fixture-view"
import type { SimpleRouteJson } from "../lib"
export default (
  <FixtureLoader
    url={url}
    title="ddr bottom io top / ca"
    description="Legacy carrier-prefix sample. The target is the first via of an already routed SoC-to-RAM connection, often close to the SoC exit. Most of the connection to RAM is fixed gray copper. This does not test routing between independently generated SoC and RAM fanouts; see the dataset audit in the repository."
  />
)
