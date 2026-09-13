import input from "./data/ddr_top_io_bottom.json"
import metadata from "./data/ddr_top_io_bottom.meta.json"
import { TwoFanouts } from "./TwoFanouts"
export default () => <TwoFanouts input={input} metadata={metadata} />
