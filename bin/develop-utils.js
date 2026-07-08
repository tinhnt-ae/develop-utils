#!/usr/bin/env node

import { runAddLicenses, help as licensesHelp } from "../lib/add-licenses.js";
import { runAddSemanticRelease, help as semanticReleaseHelp } from "../lib/add-semantic-release.js";

function mainHelp() {
  return `Usage: develop-utils <command> [options]

Commands:
  add-licenses          Create license/authorship files from git metadata.
  add-semantic-release  Add semantic-release setup to a repository.

Run "develop-utils <command> --help" for command-specific options.`;
}

async function main() {
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

  if (command === "help:add-licenses") {
    console.log(licensesHelp());
    return;
  }

  if (command === "help:add-semantic-release") {
    console.log(semanticReleaseHelp());
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
