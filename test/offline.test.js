import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { siteFiles, listedFiles } from "../.tools/scripts/offline_files.mjs";

test("the service worker caches exactly the site's files", () => {
  const listed = listedFiles(fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"));
  assert.deepEqual(listed, siteFiles(), "run: node .tools/scripts/offline_files.mjs");
});
