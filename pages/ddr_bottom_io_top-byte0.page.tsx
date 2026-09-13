import url from "../tests/fixtures/ddr_bottom_io_top-byte0.json?url";
import {FixtureLoader} from "./fixture-view";
import type {SimpleRouteJson} from "../lib";
export default <FixtureLoader url={url} title="ddr bottom io top / byte0" description="A real AM62L bus corridor: the SoC fanout ends at its saved exit, and the RAM-side destination is the first existing carrier via. The remaining RAM route and all other copper are frozen obstacles. This is a planar subproblem, not a claim that the complete RAM fanout uses no vias. Step through failures to inspect winding order and congestion."/>;
