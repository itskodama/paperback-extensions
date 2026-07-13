import { type TestLogger } from "@paperback/types";

import { LNORI } from "../LNORI/main.js";
import sourceInfo from "../LNORI/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LNORI tests", logger);
  registerDefaultTests(suite, LNORI, sourceInfo, {
    mangaProviding: {
      getMangaDetails: ["3343/re-zero-starting-life-in-another-world"],
    },
  });

  await suite.run();
}
