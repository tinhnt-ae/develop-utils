#!/usr/bin/env node

import { runAddLicenses } from "../commands/add-licenses/command.js";
import { closePrompts } from "../shared/prompts.js";

runAddLicenses()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    closePrompts();
  });
