#!/usr/bin/env node

import { runAddSemanticRelease } from "../commands/add-semantic-release/command.js";
import { closePrompts } from "../shared/prompts.js";

runAddSemanticRelease()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    closePrompts();
  });
