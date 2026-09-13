import url from "../tests/fixtures/ddr_top_io_bottom-raw.json?url";
import {FixtureLoader} from "./fixture-view";
import type {SimpleRouteJson} from "../lib";
export default <FixtureLoader url={url} title="ddr top io bottom / raw" description="Unmodified AM62L DDR phase input. Inner-layer SoC terminals and top-layer RAM pads require layer changes. The solver must reject this input; first provide compatible fixed-layer fanout endpoints."/>;
