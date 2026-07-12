import { type TestLogger } from "@paperback/types";

import { Lnori } from "../Lnori/main.js";
import sourceInfo from "../Lnori/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Lnori tests", logger);
  registerDefaultTests(suite, Lnori, sourceInfo, {
    mangaProviding: {
      getMangaDetails: ["3343/re-zero-starting-life-in-another-world"],
    },
  });

  await suite.run();
}
