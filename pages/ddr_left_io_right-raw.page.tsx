import url from "../tests/fixtures/ddr_left_io_right-raw.json?url"
import { FixtureLoader } from "./fixture-view"
import type { SimpleRouteJson } from "../lib"
export default (
  <FixtureLoader
    url={url}
    title="ddr left io right / raw"
    description="Unmodified AM62L DDR phase input. Inner-layer SoC terminals and top-layer RAM pads require layer changes. The solver must reject this input; first provide compatible fixed-layer fanout endpoints."
  />
)
