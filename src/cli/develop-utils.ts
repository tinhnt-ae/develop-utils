#!/usr/bin/env node

import { help as licensesHelp, runAddLicenses } from "../commands/add-licenses/command.js";
import { help as semanticReleaseHelp, runAddSemanticRelease } from "../commands/add-semantic-release/command.js";
import { pgHelp, runPg } from "../commands/pg/command.js";
import { closePrompts } from "../shared/prompts.js";

function mainHelp(): string {
  return `Usage: devu <command> [options]

Commands:
  add-licenses          Create license/authorship files from git metadata.
  add-semantic-release  Add semantic-release setup to a repository.
  pg                    Local PostgreSQL setup helpers.

Run "devu <command> --help" for command-specific options.

develop-utils remains available as a long-form alias.`;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "-h" || command === "--help") {
    console.log(mainHelp());
    return;
  }

  if (command === "add-licenses") {
    await runAddLicenses(args);
    return;
  }

  if (command === "add-semantic-release") {
    await runAddSemanticRelease(args);
    return;
  }

  if (command === "pg") {
    await runPg(args);
    return;
  }

  if (command === "help:add-licenses") {
    console.log(licensesHelp());
    return;
  }

  if (command === "help:add-semantic-release") {
    console.log(semanticReleaseHelp());
    return;
  }

  if (command === "help:pg") {
    console.log(pgHelp());
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    closePrompts();
  });
