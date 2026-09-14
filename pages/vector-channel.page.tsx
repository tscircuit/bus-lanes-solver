import { FixtureView } from "./fixture-view"
import { channelInput } from "../examples/vector-channel"
export default (
  <FixtureView
    input={channelInput()}
    title="Vector channel / staggered obstacle detours"
    description="Three lanes with offset endpoints. Each step expands a clearance-offset geometry vertex; cyan edges are visible candidates and pink is the current path. No grid or coordinate snapping."
  />
)
