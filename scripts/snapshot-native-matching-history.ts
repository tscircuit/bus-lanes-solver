import { mkdir } from "node:fs/promises"
import { Resvg } from "@resvg/resvg-js"
import {
  compileNativeMatchingHistoryFixture,
  runNativeMatchingHistoryFixture,
} from "../tests/fixtures/native-matching-history"
import {
  nativeMatchingHistoryReport,
  nativeMatchingHistorySvg,
} from "../tests/fixtures/native-matching-history-snapshot"

const fixture = await compileNativeMatchingHistoryFixture()
if (fixture.circuitJson.some((element) => element.type.includes("error")))
  throw Error("Core fixture compilation failed")
const result = runNativeMatchingHistoryFixture(fixture.input)
const svg = nativeMatchingHistorySvg(fixture, result)
const report = nativeMatchingHistoryReport(fixture, result)
const directory = "docs/repros/native-matching-history"
await mkdir(directory, { recursive: true })
const name = report.accepted ? "after" : "before"
await Bun.write(`${directory}/${name}.svg`, svg)
await Bun.write(`${directory}/${name}.png`, new Resvg(svg).render().asPng())
await Bun.write(
  `${directory}/${name}.json`,
  JSON.stringify(report, null, 2) + "\n",
)
console.log(
  `${name}: accepted=${report.accepted}, copper DRC issues=${report.validation.issues.length}`,
)
