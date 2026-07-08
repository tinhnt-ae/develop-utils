#!/usr/bin/env node

import { runAddSemanticRelease } from "../lib/add-semantic-release.js";

runAddSemanticRelease().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
