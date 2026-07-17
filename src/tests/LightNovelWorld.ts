import { type TestLogger } from "@paperback/types";

import { LightNovelWorld } from "../LightNovelWorld/main.js";
import sourceInfo from "../LightNovelWorld/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LightNovelWorld tests", logger);
  registerDefaultTests(suite, LightNovelWorld, sourceInfo);

  await suite.run();
}
