#!/usr/bin/env node

import { runAddLicenses } from "../lib/add-licenses.js";

runAddLicenses().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
