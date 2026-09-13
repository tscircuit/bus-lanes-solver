import url from "../tests/fixtures/ddr_bottom_io_top-raw.json?url"
import { FixtureLoader } from "./fixture-view"
import type { SimpleRouteJson } from "../lib"
export default (
  <FixtureLoader
    url={url}
    title="ddr bottom io top / raw"
    description="Unmodified AM62L DDR phase input. Inner-layer SoC terminals and top-layer RAM pads require layer changes. The solver must reject this input; first provide compatible fixed-layer fanout endpoints."
  />
)
