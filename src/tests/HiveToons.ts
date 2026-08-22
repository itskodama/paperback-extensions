import { type TestLogger } from "@paperback/types";

import { HiveToons } from "../HiveToons/main.js";
import sourceInfo from "../HiveToons/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("HiveToons tests", logger);
  // Pinned rather than inferred from search: the site's longest series exercises the whole
  // chapter list in one response, which a short title would not.
  registerDefaultTests(suite, HiveToons, sourceInfo, {
    mangaProviding: {
      getMangaDetails: ["15"],
    },
  });

  await suite.run();
}
