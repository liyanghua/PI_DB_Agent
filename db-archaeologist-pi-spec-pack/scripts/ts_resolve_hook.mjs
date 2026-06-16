// ESM resolve hook: rewrite local "./foo.js" → "./foo.ts" when the .ts exists,
// and shim @sinclair/typebox to a local stub when DBA_PI_SMOKE=1 (so smoke runs
// without pi's node_modules). Used by node --import ./scripts/ts_loader.mjs ...

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as pathResolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const TYPEBOX_STUB_URL = pathToFileURL(pathResolve(here, "typebox_stub.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (process.env.DBA_PI_SMOKE === "1" && specifier === "@sinclair/typebox") {
    return { url: TYPEBOX_STUB_URL, format: "module", shortCircuit: true };
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    specifier.endsWith(".js") &&
    context.parentURL
  ) {
    const tsSpec = specifier.slice(0, -3) + ".ts";
    try {
      const parentPath = fileURLToPath(context.parentURL);
      const url = new URL(tsSpec, context.parentURL);
      const candidate = fileURLToPath(url);
      if (existsSync(candidate)) {
        return nextResolve(tsSpec, context);
      }
      void parentPath;
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context);
}