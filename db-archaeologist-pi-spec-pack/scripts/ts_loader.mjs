// Node ESM resolve hook: rewrite local "./foo.js" → "./foo.ts" when the .ts exists.
// Usage: node --import ./scripts/ts_loader.mjs path/to/entry.ts

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

if (typeof register === "function" && process.argv[1]) {
  register("./ts_resolve_hook.mjs", import.meta.url);
}