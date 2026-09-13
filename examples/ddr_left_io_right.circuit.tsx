import input from "./data/ddr_left_io_right.json"
import metadata from "./data/ddr_left_io_right.meta.json"
import { TwoFanouts } from "./TwoFanouts"
export default () => <TwoFanouts input={input} metadata={metadata} />
