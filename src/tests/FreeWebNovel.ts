import { type TestLogger } from "@paperback/types";

import { FreeWebNovel } from "../FreeWebNovel/main.js";
import sourceInfo from "../FreeWebNovel/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("FreeWebNovel tests", logger);
  // Pinned rather than inferred from search: a long-running, always-present title
  // exercises the multi-page chapter walk, which a short novel would not.
  registerDefaultTests(suite, FreeWebNovel, sourceInfo, {
    mangaProviding: {
      getMangaDetails: ["shadow-slave"],
    },
  });

  await suite.run();
}
