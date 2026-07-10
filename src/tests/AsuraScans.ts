import { type TestLogger } from "@paperback/types";

import { AsuraScans } from "../AsuraScans/main.js";
import sourceInfo from "../AsuraScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("AsuraScans tests", logger);
  registerDefaultTests(suite, AsuraScans, sourceInfo);

  await suite.run();
}
